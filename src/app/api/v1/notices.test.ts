// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));

import { POST as claim } from "@/app/api/v1/tickets/[ref]/notices/[step]/claim/route";
import { POST as finalize } from "@/app/api/v1/tickets/[ref]/notices/[step]/finalize/route";
import { itemOf } from "@/lib/api/v1/cadastros";
import { noticeClaimResultSchema, noticeFinalizeResultSchema } from "@/lib/api/v1/notices";

import { createHarness, where } from "./test-harness";

// Avisos ao cliente (claim/finalize) da v1. A regra (trava, lease, fencing)
// mora no banco e tem teste de SQL (supabase/tests/ticket_notices.sql); aqui se
// confere o que a rota manda à RPC e como traduz cada resposta.

const TICKET_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const CLAIM_TOKEN = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const LEASE = "2026-10-09T17:02:00.000000+00:00";

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset(["notices:claim"]);
  h.tables.tickets = () => ({ data: { id: TICKET_ID }, error: null });
  h.rpcs.ticket_notice_claim = () => ({
    data: { claimed: true, claim_token: CLAIM_TOKEN, lease_expires_at: LEASE, attempts: 1 },
    error: null,
  });
  h.rpcs.ticket_notice_finalize = () => ({ data: { finalized: true, status: "sent" }, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Params = { ref: string; step: string };
type Handler = (request: Request, context: { params: Promise<Params> }) => Promise<Response>;
const call = (handler: Handler, params: Params, options: { body?: unknown; rawBody?: string } = {}) =>
  handler(h.request("/x", { method: "POST", ...options }), { params: Promise.resolve(params) });
const rpcArgs = (name: string) => h.rpcCalls.find(([rpc]) => rpc === name)?.[1];
const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

describe("POST /api/v1/tickets/{ref}/notices/{step}/claim", () => {
  it("reivindica com o token da chamada e devolve o claim_token no schema publicado", async () => {
    const response = await call(claim, { ref: TICKET_ID, step: "evt-4b0c" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(itemOf(noticeClaimResultSchema).parse(payload).data).toEqual({
      claimed: true,
      claim_token: CLAIM_TOKEN,
      lease_expires_at: LEASE,
      attempts: 1,
    });
    // Sem corpo, vale a lease padrão do banco (o argumento nem vai).
    expect(rpcArgs("ticket_notice_claim")).toEqual({ p_ticket_id: TICKET_ID, p_step: "evt-4b0c", p_token_id: "tok-1" });
  });

  it("pelo protocolo: resolve o id antes; lease pedida vai à RPC", async () => {
    const response = await call(claim, { ref: "1024", step: "resolvido" }, { body: { lease_seconds: 300 } });

    expect(response.status).toBe(200);
    expect(where(h.lastChain("tickets"), "number", 1024)).toBe(true);
    expect(rpcArgs("ticket_notice_claim")).toMatchObject({ p_ticket_id: TICKET_ID, p_lease_seconds: 300 });
  });

  it("recusa do banco (já enviado, em curso) é 200 com claimed:false e o motivo", async () => {
    h.rpcs.ticket_notice_claim = () => ({ data: { claimed: false, reason: "already_sent", finalized_at: LEASE }, error: null });
    let payload = await (await call(claim, { ref: TICKET_ID, step: "evt-1" })).json();
    expect(payload.data).toEqual({ claimed: false, reason: "already_sent", finalized_at: LEASE });

    h.rpcs.ticket_notice_claim = () => ({ data: { claimed: false, reason: "in_progress", lease_expires_at: LEASE }, error: null });
    const response = await call(claim, { ref: TICKET_ID, step: "evt-1" });
    payload = await response.json();
    expect(response.status).toBe(200);
    expect(itemOf(noticeClaimResultSchema).parse(payload).data).toEqual({
      claimed: false,
      reason: "in_progress",
      lease_expires_at: LEASE,
    });
  });

  it("passo fora do formato: 400 sem tocar a RPC; corpo inválido também", async () => {
    let response = await call(claim, { ref: TICKET_ID, step: "com espaço" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "validation_error", fields: { step: expect.any(String) } });

    response = await call(claim, { ref: TICKET_ID, step: "evt-1" }, { body: { lease_seconds: 5 } });
    expect(response.status).toBe(400);
    response = await call(claim, { ref: TICKET_ID, step: "evt-1" }, { body: { lease: 60 } });
    expect(response.status).toBe(400);
    response = await call(claim, { ref: TICKET_ID, step: "evt-1" }, { rawBody: "{não é json" });
    expect((await response.json()).error.code).toBe("invalid_json");
    expect(rpcArgs("ticket_notice_claim")).toBeUndefined();
  });

  it("ticket que não existe: 404 (protocolo na leitura, uuid pela RPC)", async () => {
    h.tables.tickets = () => ({ data: null, error: null });
    expect((await call(claim, { ref: "9999", step: "evt-1" })).status).toBe(404);

    h.rpcs.ticket_notice_claim = () => ({ data: null, error: { code: "P0002", message: "ticket_not_found" } });
    expect((await call(claim, { ref: TICKET_ID, step: "evt-1" })).status).toBe(404);
  });

  it("banco fora: 503 com Retry-After; resposta fora do formato também (nunca claimed:true inventado)", async () => {
    silence();
    h.rpcs.ticket_notice_claim = () => ({ data: null, error: { code: "08006", message: "conexão caiu" } });
    let response = await call(claim, { ref: TICKET_ID, step: "evt-1" });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");

    h.rpcs.ticket_notice_claim = () => ({ data: { claimed: true }, error: null });
    response = await call(claim, { ref: TICKET_ID, step: "evt-1" });
    expect(response.status).toBe(503);
  });

  it("sem o escopo notices:claim: 403", async () => {
    h.scopes = ["tickets:read"];
    const response = await call(claim, { ref: TICKET_ID, step: "evt-1" });
    expect(response.status).toBe(403);
    expect(rpcArgs("ticket_notice_claim")).toBeUndefined();
  });
});

describe("POST /api/v1/tickets/{ref}/notices/{step}/finalize", () => {
  const body = { claim_token: CLAIM_TOKEN, outcome: "sent" };

  it("fecha com o claim_token e o desfecho, no schema publicado", async () => {
    const response = await call(finalize, { ref: TICKET_ID, step: "evt-1" }, { body });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(itemOf(noticeFinalizeResultSchema).parse(payload).data).toEqual({ finalized: true, status: "sent" });
    expect(rpcArgs("ticket_notice_finalize")).toEqual({
      p_ticket_id: TICKET_ID,
      p_step: "evt-1",
      p_claim_token: CLAIM_TOKEN,
      p_outcome: "sent",
    });
  });

  it("falha leva o motivo (aparado)", async () => {
    h.rpcs.ticket_notice_finalize = () => ({ data: { finalized: true, status: "failed" }, error: null });
    await call(finalize, { ref: TICKET_ID, step: "evt-1" }, { body: { ...body, outcome: "failed", error: "  WhatsApp fora  " } });
    expect(rpcArgs("ticket_notice_finalize")).toMatchObject({ p_outcome: "failed", p_error: "WhatsApp fora" });
  });

  it("outra reivindicação assumiu: 409 notice_claim_lost; outro desfecho já gravado: 409 notice_already_finalized", async () => {
    h.rpcs.ticket_notice_finalize = () => ({ data: { finalized: false, reason: "claim_lost", status: "claimed" }, error: null });
    let response = await call(finalize, { ref: TICKET_ID, step: "evt-1" }, { body });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "notice_claim_lost", current: "claimed" });

    h.rpcs.ticket_notice_finalize = () => ({ data: { finalized: false, reason: "already_finalized", status: "sent" }, error: null });
    response = await call(finalize, { ref: TICKET_ID, step: "evt-1" }, { body: { ...body, outcome: "failed" } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "notice_already_finalized", current: "sent" });
  });

  it("aviso nunca reivindicado: 404", async () => {
    h.rpcs.ticket_notice_finalize = () => ({ data: null, error: { code: "P0002", message: "notice_not_found" } });
    const response = await call(finalize, { ref: TICKET_ID, step: "evt-1" }, { body });
    expect(response.status).toBe(404);
  });

  it("corpo sem claim_token, desfecho desconhecido ou campo a mais: 400 sem tocar a RPC", async () => {
    for (const bad of [{ outcome: "sent" }, { ...body, outcome: "talvez" }, { ...body, extra: 1 }, { ...body, claim_token: "x" }]) {
      expect((await call(finalize, { ref: TICKET_ID, step: "evt-1" }, { body: bad })).status).toBe(400);
    }
    expect(rpcArgs("ticket_notice_finalize")).toBeUndefined();
  });

  it("banco fora: 503 (repetir é seguro)", async () => {
    silence();
    h.rpcs.ticket_notice_finalize = () => ({ data: null, error: { code: "08006", message: "conexão caiu" } });
    const response = await call(finalize, { ref: TICKET_ID, step: "evt-1" }, { body });
    expect(response.status).toBe(503);
  });
});
