// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));

import { POST as addTags } from "@/app/api/v1/tickets/[ref]/tags/route";
import { itemOf } from "@/lib/api/v1/cadastros";
import { ticketTagsResultSchema } from "@/lib/api/v1/tickets";

import { createHarness, where } from "./test-harness";

// Etiquetas do ticket na v1. A regra (só acrescenta, vocabulário, trilha) mora
// no banco e tem teste de SQL (supabase/tests/ticket_tags.sql); aqui se confere
// o que a rota manda à RPC e como traduz cada resposta.

const TICKET_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const TAG_ID = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset(["tickets:write"]);
  h.tables.tickets = () => ({ data: { id: TICKET_ID }, error: null });
  h.rpcs.ticket_add_tags = () => ({
    data: { added: ["duvida"], tags: [{ id: TAG_ID, name: "duvida", color: "slate" }] },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Params = { ref: string };
type Handler = (request: Request, context: { params: Promise<Params> }) => Promise<Response>;
const call = (
  ref: string,
  options: { body?: unknown; rawBody?: string; headers?: Record<string, string> } = { body: { tags: ["duvida"] } }
) =>
  (addTags as Handler)(h.request("/x", { method: "POST", ...options }), { params: Promise.resolve({ ref }) });
const rpcArgs = () => h.rpcCalls.find(([rpc]) => rpc === "ticket_add_tags")?.[1];
const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

describe("POST /api/v1/tickets/{ref}/tags", () => {
  it("acrescenta com o token como autor e devolve o schema publicado", async () => {
    const response = await call(TICKET_ID, { body: { tags: ["  duvida ", "caixa"] } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(itemOf(ticketTagsResultSchema).parse(payload).data).toEqual({
      added: ["duvida"],
      tags: [{ id: TAG_ID, name: "duvida", color: "slate" }],
    });
    // Aparado pelo zod; o ator vem do token, nunca do corpo.
    expect(rpcArgs()).toEqual({ p_actor_token_id: "tok-1", p_ticket_id: TICKET_ID, p_names: ["duvida", "caixa"] });
  });

  it("pelo protocolo: acha o id antes de gravar", async () => {
    const response = await call("1424");

    expect(response.status).toBe(200);
    expect(where(h.lastChain("tickets"), "number", 1424)).toBe(true);
    expect(rpcArgs()).toMatchObject({ p_ticket_id: TICKET_ID });
  });

  it("repetir é seguro: 200 com added vazio; a Idempotency-Key do agente é aceita e ignorada", async () => {
    h.rpcs.ticket_add_tags = () => ({
      data: { added: [], tags: [{ id: TAG_ID, name: "duvida", color: "slate" }] },
      error: null,
    });
    const response = await call(TICKET_ID, { body: { tags: ["duvida"] }, headers: { "idempotency-key": "etiquetar-0001" } });

    expect(response.status).toBe(200);
    expect((await response.json()).data.added).toEqual([]);
    expect(h.rpcCalls.map(([name]) => name)).not.toContain("api_idempotency_begin");
  });

  it.each([
    ["sem tags", {}],
    ["lista vazia", { tags: [] }],
    ["mais de 20", { tags: Array.from({ length: 21 }, (_, i) => `e${i}`) }],
    ["nome em branco", { tags: ["ok", "   "] }],
    ["nome com mais de 30", { tags: ["x".repeat(31)] }],
    ["quebra de linha", { tags: ["linha\nquebrada"] }],
    ["não é texto", { tags: [42] }],
    ["campo a mais", { tags: ["duvida"], extra: 1 }],
  ])("%s: 400 sem tocar a RPC", async (_, body) => {
    const response = await call(TICKET_ID, { body });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_error");
    expect(rpcArgs()).toBeUndefined();
  });

  it("JSON inválido: 400 invalid_json", async () => {
    const response = await call(TICKET_ID, { rawBody: "{não é json" });

    expect((await response.json()).error.code).toBe("invalid_json");
    expect(rpcArgs()).toBeUndefined();
  });

  it("ticket que não existe: 404 (protocolo na leitura, uuid pela RPC)", async () => {
    h.tables.tickets = () => ({ data: null, error: null });
    expect((await call("9999")).status).toBe(404);
    expect(rpcArgs()).toBeUndefined();

    h.rpcs.ticket_add_tags = () => ({ data: null, error: { code: "P0001", message: "TICKET_NOT_FOUND" } });
    expect((await call(TICKET_ID)).status).toBe(404);
    expect((await call("não-é-ref")).status).toBe(404);
  });

  it("o banco recusa os nomes: 400 com o campo tags", async () => {
    h.rpcs.ticket_add_tags = () => ({ data: null, error: { code: "P0001", message: "INVALID_TAGS" } });
    const response = await call(TICKET_ID);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "validation_error", fields: { tags: expect.any(String) } });
  });

  it("token revogado entre o guard e a RPC: 403", async () => {
    h.rpcs.ticket_add_tags = () => ({ data: null, error: { code: "P0001", message: "FORBIDDEN" } });
    expect((await call(TICKET_ID)).status).toBe(403);
  });

  it("erro do banco ou retorno fora do formato: 500 sem repassar a mensagem do banco", async () => {
    silence();
    h.rpcs.ticket_add_tags = () => ({ data: null, error: { code: "XX000", message: "segredo do banco" } });
    let response = await call(TICKET_ID);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("segredo do banco");

    h.rpcs.ticket_add_tags = () => ({ data: { added: "duvida" }, error: null });
    response = await call(TICKET_ID);
    expect(response.status).toBe(500);
  });

  it("leitura do protocolo falhou: 503", async () => {
    silence();
    h.tables.tickets = () => ({ data: null, error: { code: "08006", message: "conexão caiu" } });
    expect((await call("1424")).status).toBe(503);
  });

  it("sem o escopo tickets:write: 403 sem tocar a RPC", async () => {
    h.scopes = ["tickets:read", "comments:write"];
    const response = await call(TICKET_ID);

    expect(response.status).toBe(403);
    expect(rpcArgs()).toBeUndefined();
  });
});
