// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));
vi.mock("@/features/chat/lib/push-takeover", () => ({ pushTakeoverToAgent: vi.fn() }));

import { POST as assignTicket } from "@/app/api/v1/tickets/[ref]/assign/route";
import { GET as getTicket, PATCH as patchTicket } from "@/app/api/v1/tickets/[ref]/route";
import { POST as transitionTicket } from "@/app/api/v1/tickets/[ref]/transitions/route";
import { GET as listTickets, POST as createTicket } from "@/app/api/v1/tickets/route";
import { itemOf, pageOf } from "@/lib/api/v1/cadastros";
import { encodeCursor } from "@/lib/api/v1/cursor";
import {
  ticketChangeSchema,
  ticketDetailSchema,
  ticketSchema,
  ticketTransitionResultSchema,
} from "@/lib/api/v1/tickets";

import { createHarness, has, where } from "./test-harness";

// Tickets da v1 (PR 8a): leitura, abertura idempotente e as escritas com
// If-Match (D7). Supabase falso de test-harness.ts.

const TICKET_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const CONVERSATION_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const CONTACT_ID = "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const USER_ID = "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b";
// Um uuid por filtro: trocar as colunas na rota não pode passar no teste.
const PRODUCT_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const CUSTOMER_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const PAST = "2026-01-01T00:00:00+00:00";
const FUTURE = "2099-01-01T00:00:00+00:00";

const ticketRow = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  number: 1424,
  title: "PDV não abre",
  status: "em_atendimento",
  priority: "alta",
  version: 3,
  source: "ai",
  conversation_id: CONVERSATION_ID,
  is_terminal: false,
  reopened_count: 0,
  sla_mode: "running",
  sla_first_response_minutes: 30,
  sla_resolution_minutes: 240,
  sla_warn_pct: 80,
  first_response_due_at: FUTURE,
  resolution_due_at: FUTURE,
  first_responded_at: PAST,
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: FUTURE,
  last_inbound_at: PAST,
  replied_after_resolve: false,
  created_at: PAST,
  updated_at: "2026-09-29T12:00:00.123456+00:00",
  customer: { id: "cu1", legal_name: "Padaria LTDA", trade_name: null, contract_status: "ativo" },
  contact: { id: CONTACT_ID, name: "Maria", phone: "5527999990000" },
  product: { id: "q1", name: "ERP", color: "blue" },
  assignee: { id: USER_ID, name: "Ana", avatar_color: "blue", avatar_url: null },
  description: "Erro 1045 ao abrir",
  category: { id: "c1", name: "Instalação" },
  ...overrides,
});

// O jsonb de public.ticket_summary, como toda RPC de ticket devolve.
const summary = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  number: 1424,
  title: "PDV não abre",
  status: "em_atendimento",
  priority: "alta",
  version: 4,
  conversation_id: CONVERSATION_ID,
  assigned_to_user_id: null,
  product_id: null,
  category_id: null,
  customer_id: null,
  contract_id: null,
  first_response_due_at: FUTURE,
  resolution_due_at: FUTURE,
  first_responded_at: null,
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  updated_at: PAST,
  ...overrides,
});

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset(["tickets:read", "tickets:write"]);
  // Releitura depois da escrita (e o GET): a versão nova.
  h.tables.ticket_queue = (calls) =>
    calls.some(([method]) => method === "maybeSingle")
      ? { data: ticketRow({ version: 4 }), error: null }
      : { data: [ticketRow()], error: null };
  h.tables.tickets = () => ({ data: { id: TICKET_ID }, error: null });
  h.rpcs.create_ticket = () => ({
    data: {
      ticket: summary({ version: 1 }),
      created: true,
      linked_messages: 2,
      conversation_changed: false,
      conversation_external_id: "5527999990000@s.whatsapp.net",
    },
    error: null,
  });
  h.rpcs.ticket_update = () => ({ data: { ticket: summary(), changed: true }, error: null });
  h.rpcs.ticket_transition = () => ({
    data: { ticket: summary({ status: "resolvido" }), from: "em_atendimento", to: "resolvido", changed: true },
    error: null,
  });
  h.rpcs.ticket_assign = () => ({ data: { ticket: summary(), changed: true }, error: null });
});

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;
function call<P extends object>(
  handler: Handler<P>,
  options: { path?: string; method?: string; body?: unknown; rawBody?: string; params?: P; headers?: Record<string, string> } = {}
) {
  return handler(h.request(options.path ?? "/tickets", options), { params: Promise.resolve((options.params ?? {}) as P) });
}
const json = async (response: Response) => response.json();
const rpcArgs = (name: string) => h.rpcCalls.find(([rpc]) => rpc === name)?.[1];
const rpcNames = () => h.rpcCalls.map(([name]) => name);

// ─── GET /tickets ────────────────────────────────────────────────────────────

describe("GET /api/v1/tickets", () => {
  it("responde no schema publicado, em updated_at crescente, sem campos de tela", async () => {
    const response = await call(listTickets);
    const body = await json(response);

    expect(response.status).toBe(200);
    const parsed = pageOf(ticketSchema).safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(body.data[0]).toMatchObject({ contact_id: CONTACT_ID, customer_id: "cu1", assignee: { id: USER_ID, name: "Ana" } });
    expect(body.data[0].assignee).not.toHaveProperty("avatar_color");
    const calls = h.lastChain("ticket_queue");
    expect(has(calls, "order", "updated_at", { ascending: true })).toBe(true);
    expect(has(calls, "order", "id", { ascending: true })).toBe(true);
    expect(has(calls, "limit", 51)).toBe(true);
  });

  it("aplica cada filtro na consulta", async () => {
    h.scopes = ["tickets:read", "contacts:read", "customers:read"];
    const cursor = encodeCursor({ updated_at: PAST, id: TICKET_ID });
    await call(listTickets, {
      path:
        `/tickets?status=novo,em_triagem&priority=alta&is_terminal=false&sla_breached=true&product_id=${PRODUCT_ID}` +
        `&customer_id=${CUSTOMER_ID}&contact_id=${CONTACT_ID}&conversation_id=${CONVERSATION_ID}` +
        `&q=nota%20fiscal&updated_since=2026-09-29T09:00:00-03:00&cursor=${cursor}`,
    });

    const calls = h.lastChain("ticket_queue");
    expect(has(calls, "in", "status", ["novo", "em_triagem"])).toBe(true);
    expect(has(calls, "in", "priority", ["alta"])).toBe(true);
    expect(where(calls, "is_terminal", false)).toBe(true);
    expect(where(calls, "sla_breached", true)).toBe(true);
    expect(where(calls, "product_id", PRODUCT_ID)).toBe(true);
    expect(where(calls, "customer_id", CUSTOMER_ID)).toBe(true);
    expect(where(calls, "contact_id", CONTACT_ID)).toBe(true);
    expect(where(calls, "conversation_id", CONVERSATION_ID)).toBe(true);
    expect(has(calls, "ilike", "search_text", "%nota%")).toBe(true);
    expect(has(calls, "ilike", "search_text", "%fiscal%")).toBe(true);
    expect(has(calls, "gte", "updated_at", "2026-09-29T12:00:00.000Z")).toBe(true);
    expect(has(calls, "or", `updated_at.gt.${PAST},and(updated_at.eq.${PAST},id.gt.${TICKET_ID})`)).toBe(true);
  });

  it("q sem contacts:read e customers:read é 403: a busca alcança o nome do contato e o CNPJ da empresa", async () => {
    h.scopes = ["tickets:read", "contacts:read"];

    const response = await call(listTickets, { path: "/tickets?q=padaria" });
    const body = await json(response);

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({ code: "insufficient_scope", required: ["customers:read"] });
    expect(h.chains.ticket_queue).toBeUndefined();
  });

  it("assignee_id=none é 'sem responsável'; um uuid é igualdade", async () => {
    await call(listTickets, { path: "/tickets?assignee_id=none" });
    expect(has(h.lastChain("ticket_queue"), "is", "assigned_to_user_id", null)).toBe(true);

    await call(listTickets, { path: `/tickets?assignee_id=${USER_ID}` });
    expect(where(h.lastChain("ticket_queue"), "assigned_to_user_id", USER_ID)).toBe(true);
  });

  it.each([
    ["status desconhecido", "/tickets?status=novo,arquivado", "status"],
    ["prioridade desconhecida", "/tickets?priority=urgente", "priority"],
    ["responsável fora de uuid", "/tickets?assignee_id=ana", "assignee_id"],
    ["q de uma letra", "/tickets?q=a", "q"],
    ["parâmetro de outra lista", "/tickets?include_archived=true", "include_archived"],
  ])("%s é 400 no campo, sem consultar", async (_label, path, field) => {
    const response = await call(listTickets, { path });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty(field);
    expect(h.chains.ticket_queue).toBeUndefined();
  });

  it("leitura que falhou (ou linha fora do tipo) é 503, nunca lista vazia", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.tables.ticket_queue = () => ({ data: null, error: { message: "boom" } });
    expect((await call(listTickets)).status).toBe(503);

    h.tables.ticket_queue = () => ({ data: [ticketRow({ status: "arquivado" })], error: null });
    expect((await call(listTickets)).status).toBe(503);
    spy.mockRestore();
  });

  it("exige tickets:read (tickets:write sozinho não lê)", async () => {
    h.scopes = ["tickets:write"];

    expect((await call(listTickets)).status).toBe(403);
    expect(h.chains.ticket_queue).toBeUndefined();
  });
});

// ─── GET /tickets/{ref} ──────────────────────────────────────────────────────

describe("GET /api/v1/tickets/{ref}", () => {
  it("pelo id: o ticket inteiro no schema publicado, com o ETag da versão", async () => {
    const response = await call(getTicket, { params: { ref: TICKET_ID } });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('W/"4"');
    const parsed = itemOf(ticketDetailSchema).safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(body.data).toMatchObject({ description: "Erro 1045 ao abrir", category: { id: "c1", name: "Instalação" } });
    expect(where(h.lastChain("ticket_queue"), "id", TICKET_ID)).toBe(true);
  });

  it("pelo protocolo: procura pelo número", async () => {
    await call(getTicket, { params: { ref: "1424" } });

    expect(where(h.lastChain("ticket_queue"), "number", 1424)).toBe(true);
  });

  it.each(["abc", "0", "01", "-3", "99999999999"])("ref %s é 404 sem consultar", async (ref) => {
    const response = await call(getTicket, { params: { ref } });

    expect(response.status).toBe(404);
    expect(h.chains.ticket_queue).toBeUndefined();
  });

  it("inexistente é 404; falha é 503", async () => {
    h.tables.ticket_queue = () => ({ data: null, error: null });
    expect((await call(getTicket, { params: { ref: TICKET_ID } })).status).toBe(404);

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.tables.ticket_queue = () => ({ data: null, error: { message: "boom" } });
    expect((await call(getTicket, { params: { ref: TICKET_ID } })).status).toBe(503);
    spy.mockRestore();
  });
});

// ─── POST /tickets ───────────────────────────────────────────────────────────

describe("POST /api/v1/tickets", () => {
  const body = { conversation_id: CONVERSATION_ID, title: "PDV não abre" };
  const post = (payload: unknown = body, headers: Record<string, string> = { "idempotency-key": "abertura-0001" }) =>
    call(createTicket, { method: "POST", body: payload, headers });

  it("abre como o token, sem assumir, com a Idempotency-Key também na RPC", async () => {
    const response = await post({
      ...body,
      priority: "alta",
      status: "em_triagem",
      external_id: "erp-77",
      ai_triage: { resumo: "PDV", confianca: 0.9 },
      assignee_id: USER_ID,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("ETag")).toBe('W/"4"');
    expect(itemOf(ticketDetailSchema).safeParse(await json(response)).success).toBe(true);
    const args = rpcArgs("create_ticket");
    expect(args).toMatchObject({
      p_actor_token_id: "tok-1",
      p_conversation_id: CONVERSATION_ID,
      p_title: "PDV não abre",
      p_priority: "alta",
      p_take_over: false,
      p_idempotency_key: "abertura-0001",
      p_status: "em_triagem",
      p_external_id: "erp-77",
      p_ai_triage: { resumo: "PDV", confianca: 0.9 },
      p_assigned_to_user_id: USER_ID,
    });
    expect(args).not.toHaveProperty("p_actor_user_id");
    // A resposta é o ticket RELIDO pelo id que a RPC devolveu.
    expect(where(h.lastChain("ticket_queue"), "id", TICKET_ID)).toBe(true);
  });

  it("prioridade ausente vale media", async () => {
    await post();

    expect(rpcArgs("create_ticket")).toMatchObject({ p_priority: "media" });
  });

  it("já existia (mesma chave deste token): 200 com o ticket como está", async () => {
    h.rpcs.create_ticket = () => ({
      data: { ticket: summary(), created: false, linked_messages: 0, conversation_changed: false, conversation_external_id: "x" },
      error: null,
    });

    expect((await post()).status).toBe(200);
  });

  it.each([
    ["sem título", { conversation_id: CONVERSATION_ID }, "title"],
    ["status inicial fora de novo/em_triagem", { ...body, status: "em_atendimento" }, "status"],
    ["take_over (token não assume)", { ...body, take_over: true }, "take_over"],
    ["ai_triage que não é objeto", { ...body, ai_triage: [1, 2] }, "ai_triage"],
    ["ai_triage acima de 16 KB", { ...body, ai_triage: { texto: "x".repeat(17000) } }, "ai_triage"],
    ["external_id vazio", { ...body, external_id: "  " }, "external_id"],
    // 7.000 itens: 14 KB em JSON compacto, 21 KB como o jsonb guarda (": " e ", ").
    ["ai_triage que só estoura no formato do banco", { ...body, ai_triage: { a: Array(7000).fill(1) } }, "ai_triage"],
    ["ai_triage com número em notação científica", { ...body, ai_triage: { score: 1e300 } }, "ai_triage"],
    ["ai_triage com NUL numa string aninhada", { ...body, ai_triage: { itens: ["ok", "x\u0000"] } }, "ai_triage"],
    ["fila vazia em vez de null", { ...body, product_id: "" }, "product_id"],
    ["corpo que não é objeto", [], "body"],
  ])("%s é 400 no campo, sem chamar a RPC", async (_label, payload, field) => {
    const response = await post(payload);

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty(field);
    expect(rpcNames()).not.toContain("create_ticket");
  });

  it("ai_triage perto do teto, no formato do banco, passa", async () => {
    await post({ ...body, ai_triage: { a: Array(5000).fill(1) } });

    expect(rpcNames()).toContain("create_ticket");
  });

  it("external_id já usado em outra conversa: 422 que aponta o external_id, não só a chave", async () => {
    h.rpcs.create_ticket = () => ({ data: null, error: { message: "IDEMPOTENCY_KEY_REUSED" } });

    const withExternal = await json(await post({ ...body, external_id: "erp-77" }));
    expect(withExternal.error).toMatchObject({ code: "idempotency_key_reused", fields: { external_id: expect.any(String) } });
    expect(withExternal.error.message).toContain("external_id");

    const withoutExternal = await json(await post(body, { "idempotency-key": "abertura-0002" }));
    expect(withoutExternal.error.fields).toBeUndefined();

    // A recusa de chave reusada não fica guardada: quem a recebe não toma a chave.
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("violação do teto no banco aponta o campo ai_triage", async () => {
    h.rpcs.create_ticket = () => ({
      data: null,
      error: { message: 'new row for relation "tickets" violates check constraint "tickets_ai_triage_check"', code: "23514" },
    });

    const response = await post({ ...body, ai_triage: { a: 1 } });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty("ai_triage");
  });

  it("sem Idempotency-Key é 400 antes de tudo", async () => {
    const response = await post(body, {});

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("idempotency_key_required");
    expect(h.rpcCalls).toEqual([]);
  });

  it.each([
    ["chave já usada em outra conversa", { message: "IDEMPOTENCY_KEY_REUSED" }, 422, "idempotency_key_reused"],
    ["conversa inexistente", { message: "CONVERSATION_NOT_FOUND" }, 404, "not_found"],
    ["fila arquivada", { message: "PRODUCT_ARCHIVED" }, 422, "product_archived"],
    ["token revogado no meio", { message: "FORBIDDEN" }, 403, "forbidden"],
  ])("%s: %s no envelope da v1", async (_label, error, status, code) => {
    h.rpcs.create_ticket = () => ({ data: null, error });

    const response = await post();

    expect(response.status).toBe(status);
    expect((await json(response)).error.code).toBe(code);
  });

  it("erro inesperado da RPC é 500 sem a mensagem do banco", async () => {
    h.rpcs.create_ticket = () => ({ data: null, error: { message: "segredo do banco", code: "XX000" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await post();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await json(response))).not.toContain("segredo do banco");
    spy.mockRestore();
  });

  it("releitura que falhou é 503 (repetir é seguro: a RPC devolve o já aberto)", async () => {
    h.tables.ticket_queue = () => ({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await post()).status).toBe(503);
    expect(rpcNames()).toContain("api_idempotency_release");
    spy.mockRestore();
  });

  it("exige tickets:write", async () => {
    h.scopes = ["tickets:read"];

    expect((await post()).status).toBe(403);
    expect(h.rpcCalls).toEqual([]);
  });
});

// ─── Escritas com If-Match ───────────────────────────────────────────────────

describe("PATCH /api/v1/tickets/{ref}", () => {
  const patch = (payload: unknown, headers: Record<string, string> = { "if-match": 'W/"3"' }, ref = TICKET_ID) =>
    call(patchTicket, { method: "PATCH", body: payload, headers, params: { ref } });

  it("altera só o que veio, com a versão do If-Match, e devolve o ticket relido com o ETag novo", async () => {
    const response = await patch({ title: "PDV trava", product_id: null });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('W/"4"');
    expect(itemOf(ticketChangeSchema).safeParse(body).error?.issues ?? []).toEqual([]);
    expect(body.data).toMatchObject({ changed: true, ticket: { id: TICKET_ID, version: 4 } });
    expect(rpcArgs("ticket_update")).toEqual({
      p_actor_token_id: "tok-1",
      p_ticket_id: TICKET_ID,
      p_expected_version: 3,
      p_patch: { title: "PDV trava", product_id: null },
    });
  });

  it("sem If-Match é 428; malformado é 400; sem chamar a RPC", async () => {
    const missing = await patch({ title: "PDV trava" }, {});
    expect(missing.status).toBe(428);
    expect((await json(missing)).error.code).toBe("precondition_required");

    const invalid = await patch({ title: "PDV trava" }, { "if-match": "*" });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error.code).toBe("invalid_if_match");
    expect(rpcNames()).not.toContain("ticket_update");
  });

  it("pelo protocolo: acha o id antes da RPC", async () => {
    h.tables.tickets = () => ({ data: { id: TICKET_ID }, error: null });

    await patch({ title: "PDV trava" }, { "if-match": 'W/"3"' }, "1424");

    expect(where(h.lastChain("tickets"), "number", 1424)).toBe(true);
    expect(rpcArgs("ticket_update")).toMatchObject({ p_ticket_id: TICKET_ID });
  });

  it("protocolo inexistente é 404 sem RPC", async () => {
    h.tables.tickets = () => ({ data: null, error: null });

    expect((await patch({ title: "PDV trava" }, { "if-match": 'W/"3"' }, "999")).status).toBe(404);
    expect(rpcNames()).not.toContain("ticket_update");
  });

  it("versão velha é 412, com a versão atual no corpo e no ETag", async () => {
    h.rpcs.ticket_update = () => ({ data: null, error: { message: "VERSION_CONFLICT", details: "5" } });

    const response = await patch({ title: "PDV trava" });
    const body = await json(response);

    expect(response.status).toBe(412);
    expect(response.headers.get("ETag")).toBe('W/"5"');
    expect(body.error).toMatchObject({ code: "version_conflict", current_version: 5 });
  });

  it("erro de validação da RPC sai como validation_error, o código das outras rotas da v1", async () => {
    h.rpcs.ticket_update = () => ({ data: null, error: { message: "INVALID_PATCH" } });

    const response = await patch({ title: "PDV trava" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("validation_error");
  });

  it.each([
    ["ticket encerrado", { message: "TICKET_TERMINAL" }, 409, "ticket_terminal", null],
    ["empresa arquivada", { message: "CUSTOMER_ARCHIVED" }, 422, "customer_archived", "customer_id"],
  ])("%s: %s", async (_label, error, status, code, field) => {
    h.rpcs.ticket_update = () => ({ data: null, error });

    const response = await patch({ customer_id: USER_ID });
    const body = await json(response);

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
    if (field) expect(body.error.fields).toHaveProperty(field);
  });

  it.each([
    ["nada para alterar", {}, null],
    ["status tem rota própria", { status: "resolvido" }, "status"],
    ["versão vai no If-Match, não no corpo", { title: "PDV trava", version: 3 }, "version"],
    ["\"\" não tira a fila: só null tira", { product_id: "" }, "product_id"],
    ["\"\" não tira a categoria: só null tira", { category_id: "" }, "category_id"],
    ["\"\" não tira a empresa: só null tira", { customer_id: "" }, "customer_id"],
  ])("%s é 400, sem RPC", async (_label, payload, field) => {
    const response = await patch(payload);
    const body = await json(response);

    expect(response.status).toBe(400);
    if (field) expect(body.error.fields).toHaveProperty(field);
    expect(rpcNames()).not.toContain("ticket_update");
  });
});

describe("POST /api/v1/tickets/{ref}/transitions", () => {
  const transition = (payload: unknown, headers: Record<string, string> = { "if-match": 'W/"3"' }) =>
    call(transitionTicket, { method: "POST", body: payload, headers, params: { ref: TICKET_ID } });

  it("move pela matriz e devolve de onde para onde", async () => {
    const response = await transition({ to: "resolvido" });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('W/"4"');
    expect(itemOf(ticketTransitionResultSchema).safeParse(body).error?.issues ?? []).toEqual([]);
    expect(body.data).toMatchObject({ changed: true, from: "em_atendimento", to: "resolvido", ticket: { id: TICKET_ID } });
    expect(rpcArgs("ticket_transition")).toMatchObject({ p_to: "resolvido", p_expected_version: 3, p_actor_token_id: "tok-1" });
  });

  it("destino fora da matriz: 409 com allowed e current", async () => {
    h.rpcs.ticket_transition = () => ({
      data: null,
      error: { message: "INVALID_TRANSITION", details: '["aguardando_cliente", "resolvido"]', hint: "em_atendimento" },
    });

    const response = await transition({ to: "novo" });
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: "invalid_transition",
      allowed: ["aguardando_cliente", "resolvido"],
      current: "em_atendimento",
    });
  });

  it("cancelar leva o motivo à RPC", async () => {
    await transition({ to: "cancelado", reason: "Cliente desistiu" });

    expect(rpcArgs("ticket_transition")).toMatchObject({ p_to: "cancelado", p_reason: "Cliente desistiu" });
  });

  it("cancelar sem motivo é 400 no campo reason, sem RPC", async () => {
    const response = await transition({ to: "cancelado" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty("reason");
    expect(rpcNames()).not.toContain("ticket_transition");
  });

  it("sem If-Match é 428", async () => {
    expect((await transition({ to: "resolvido" }, {})).status).toBe(428);
  });

  it("versão velha é 412 com o ETag atual", async () => {
    h.rpcs.ticket_transition = () => ({ data: null, error: { message: "VERSION_CONFLICT", details: "7" } });

    const response = await transition({ to: "resolvido" });

    expect(response.status).toBe(412);
    expect(response.headers.get("ETag")).toBe('W/"7"');
  });

  it("releitura que falhou depois da escrita é 503 (repetir é seguro)", async () => {
    h.tables.ticket_queue = () => ({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await transition({ to: "resolvido" })).status).toBe(503);
    expect(rpcNames()).toContain("ticket_transition");
    spy.mockRestore();
  });
});

describe("POST /api/v1/tickets/{ref}/assign", () => {
  const assign = (payload: unknown, ref = TICKET_ID) =>
    call(assignTicket, { method: "POST", body: payload, headers: { "if-match": 'W/"3"' }, params: { ref } });

  it("troca o responsável; null tira", async () => {
    const response = await assign({ assignee_id: USER_ID });
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('W/"4"');
    expect(itemOf(ticketChangeSchema).safeParse(await json(response)).error?.issues ?? []).toEqual([]);
    expect(rpcArgs("ticket_assign")).toMatchObject({ p_assignee_id: USER_ID, p_expected_version: 3 });

    h.rpcCalls.length = 0;
    expect((await assign({ assignee_id: null })).status).toBe(200);
    // Ausente = o default null da RPC = sem responsável.
    expect(rpcArgs("ticket_assign")?.p_assignee_id).toBeUndefined();
  });

  it("pelo protocolo: acha o id antes da RPC", async () => {
    await assign({ assignee_id: USER_ID }, "1424");

    expect(where(h.lastChain("tickets"), "number", 1424)).toBe(true);
    expect(rpcArgs("ticket_assign")).toMatchObject({ p_ticket_id: TICKET_ID });
  });

  it("\"\" não é null: 400 no campo", async () => {
    const response = await assign({ assignee_id: "" });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty("assignee_id");
  });

  it("assignee_id ausente é 400: tirar o responsável tem de ser explícito", async () => {
    const response = await assign({});

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toHaveProperty("assignee_id");
  });

  it("responsável inativo: 422 no campo", async () => {
    h.rpcs.ticket_assign = () => ({ data: null, error: { message: "ASSIGNEE_INACTIVE" } });

    const response = await assign({ assignee_id: USER_ID });
    const body = await json(response);

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: "assignee_inactive", fields: { assignee_id: expect.any(String) } });
  });
});
