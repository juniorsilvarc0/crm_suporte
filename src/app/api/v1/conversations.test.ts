// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { adminClientMock, pushTakeoverMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  pushTakeoverMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));
vi.mock("@/features/chat/lib/push-takeover", () => ({ pushTakeoverToAgent: pushTakeoverMock }));

import { PUT as putActiveTicket } from "@/app/api/v1/conversations/[id]/active-ticket/route";
import { POST as postHandoff } from "@/app/api/v1/conversations/[id]/handoff/route";
import { GET as getMessages } from "@/app/api/v1/conversations/[id]/messages/route";
import { GET as getConversation } from "@/app/api/v1/conversations/[id]/route";
import { olderThanFilter } from "@/features/chat/lib/messages-page";
import { itemOf, pageOf } from "@/lib/api/v1/cadastros";
import {
  activeTicketBodySchema,
  activeTicketResultSchema,
  CONVERSATION_DETAIL_SELECT,
  CONVERSATION_MESSAGE_SELECT,
  conversationDetailSchema,
  conversationMessageSchema,
  handoffBodySchema,
  handoffResultSchema,
} from "@/lib/api/v1/conversations";
import { decodeMessageCursor, encodeCursor, encodeMessageCursor } from "@/lib/api/v1/cursor";
import { buildOpenApiDocument } from "@/lib/api/v1/openapi";

import { createHarness, has, where, type Responder } from "./test-harness";

// Conversa na v1 (PR 10a): ler a conversa e as mensagens, handoff e ticket em
// foco. Supabase falso de test-harness.ts; o aviso ao agente é mock (tem teste
// próprio): aqui se confere o que a rota manda ao banco e devolve.

const CONV_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CONTACT_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const TICKET_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const NOTE_ID = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
// O endereço do canal e o telefone do contato: nunca saem numa resposta.
const EXTERNAL_ID = "5500900001111";
const CONTACT_PHONE = "+5500900001111";
const PAST = "2026-09-29T12:00:00.123456+00:00";

// A linha como o banco a tem, com o que NÃO pode sair na resposta.
const conversationRow = (overrides: Record<string, unknown> = {}) => ({
  id: CONV_ID,
  status: "bot",
  active_ticket_id: null,
  last_message_at: PAST,
  archived_at: null,
  created_at: PAST,
  contact_id: CONTACT_ID,
  external_id: EXTERNAL_ID,
  contact_phone: CONTACT_PHONE,
  contact_name: "Maria da Silva",
  metadata: { interno: true },
  ...overrides,
});

const messageRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  direction: "inbound",
  sender_type: "contact",
  type: "text",
  content: `mensagem ${n}`,
  media_mime_type: null,
  is_deleted: false,
  delivery_status: "delivered",
  ticket_id: null,
  quoted_message_id: null,
  created_at: `2026-09-29T12:00:0${n}.123456+00:00`,
  sent_by_user_id: null,
  sent_by_token_id: null,
  conversation_id: CONV_ID,
  external_id: `wamid-${n}`,
  media_url: `/api/chat/media/${n}`,
  metadata: { clientId: "x" },
  ...overrides,
});

const handoffData = (overrides: Record<string, unknown> = {}) => ({
  conversation_id: CONV_ID,
  status: "human",
  changed: true,
  ticket_id: TICKET_ID,
  note_id: NOTE_ID,
  conversation_external_id: EXTERNAL_ID,
  ...overrides,
});

const dbError: Responder = () => ({ data: null, error: { message: "segredo do banco", code: "XX000" } });
const rpcError = (message: string, extra: { hint?: string; details?: string } = {}) => () => ({
  data: null,
  error: { message, code: "P0001", details: extra.details ?? "", hint: extra.hint ?? "" },
});

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset(["conversations:read", "conversations:handoff", "tickets:write"]);
  h.tables.chat_conversations = () => ({ data: conversationRow(), error: null });
  h.tables.chat_messages = () => ({ data: [messageRow(3), messageRow(2), messageRow(1)], error: null });
  h.rpcs.conversation_handoff = () => ({ data: handoffData(), error: null });
  h.rpcs.ticket_set_active = () => ({ data: { active_ticket_id: TICKET_ID, changed: true }, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;
function call<P extends object>(
  handler: Handler<P>,
  options: { path?: string; method?: string; body?: unknown; rawBody?: string; params: P; headers?: Record<string, string> }
) {
  return handler(h.request(options.path ?? "/x", options), { params: Promise.resolve(options.params) });
}
const json = async (response: Response) => {
  const payload = await response.json();
  // O suporte acha a chamada pelo request_id: o do corpo tem de ser o do header.
  if (payload.ok === false) expect(payload.request_id).toBe(response.headers.get("X-Request-Id"));
  return payload;
};
const tableCalls = (...tables: string[]) => tables.flatMap((table) => h.chains[table] ?? []).flat();
const WRITES = ["insert", "update", "upsert", "delete"];
const logged = (spy: ReturnType<typeof silence>, payload: { request_id: string }) =>
  spy.mock.calls.some(([first]) => typeof first === "string" && first.includes(payload.request_id));
const rpcNames = () => h.rpcCalls.map(([name]) => name);
const rpcArgs = (name: string) => h.rpcCalls.find(([called]) => called === name)?.[1];
// O supabase-js serializa os argumentos em JSON: chave com undefined some.
const sent = (name: string) => JSON.parse(JSON.stringify(rpcArgs(name) ?? null)) as Record<string, unknown> | null;
const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
const noSecrets = (payload: unknown) => {
  const text = JSON.stringify(payload);
  for (const secret of [EXTERNAL_ID, CONTACT_PHONE, "Maria da Silva", "segredo do banco", "wamid-", "/api/chat/media"]) {
    expect(text, secret).not.toContain(secret);
  }
};

// ─── GET /conversations/{id} ─────────────────────────────────────────────────

describe("GET /api/v1/conversations/{id}", () => {
  const read = (id = CONV_ID) => call(getConversation, { params: { id } });

  it("devolve a conversa no schema publicado, sem telefone, nome nem metadata", async () => {
    const response = await read();
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(itemOf(conversationDetailSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(payload.data).toEqual({
      id: CONV_ID,
      status: "bot",
      active_ticket_id: null,
      last_message_at: PAST,
      archived_at: null,
      created_at: PAST,
      contact_id: CONTACT_ID,
    });
    noSecrets(payload);
    expect(has(h.lastChain("chat_conversations"), "select", CONVERSATION_DETAIL_SELECT)).toBe(true);
    expect(where(h.lastChain("chat_conversations"), "id", CONV_ID)).toBe(true);
    // maybeSingle: com single, a conversa que não existe viraria erro (503), não 404.
    expect(has(h.lastChain("chat_conversations"), "maybeSingle")).toBe(true);
  });

  it("basta conversations:read: nenhum outro escopo é exigido", async () => {
    h.scopes = ["conversations:read"];

    expect((await read()).status).toBe(200);
  });

  it("só lê: nenhuma escrita na conversa (não zera as não lidas)", async () => {
    expect((await read()).status).toBe(200);

    const methods = tableCalls("chat_conversations", "chat_messages").map(([method]) => method);
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.filter((method) => WRITES.includes(method))).toEqual([]);
    expect(rpcNames()).toEqual([]);
  });

  it.each(["nao-e-uuid", "1024", `${CONV_ID}x`])("id malformado (%s) é 404 sem tocar a conversa", async (id) => {
    const response = await read(id);

    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("not_found");
    expect(h.chains.chat_conversations).toBeUndefined();
  });

  it("conversa que não existe é 404", async () => {
    h.tables.chat_conversations = () => ({ data: null, error: null });

    const response = await read();

    expect(response.status).toBe(404);
    expect((await json(response)).error).toMatchObject({ code: "not_found", message: "Conversa não encontrada." });
  });

  it("leitura que falhou é 503 com Retry-After, logada com o request_id e sem a mensagem do banco na resposta", async () => {
    h.tables.chat_conversations = dbError;
    const log = silence();

    const response = await read();
    const payload = await json(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(payload.error.code).toBe("unavailable");
    noSecrets(payload);
    expect(logged(log, payload)).toBe(true);
  });

  it("status fora do vocabulário é 503, nunca uma conversa com dado errado", async () => {
    h.tables.chat_conversations = () => ({ data: conversationRow({ status: "arquivada" }), error: null });
    silence();

    expect((await read()).status).toBe(503);
  });

  it("exige conversations:read", async () => {
    h.scopes = ["tickets:read", "conversations:handoff"];

    const response = await read();

    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: "insufficient_scope", required: ["conversations:read"] });
    expect(h.chains.chat_conversations).toBeUndefined();
  });
});

// ─── GET /conversations/{id}/messages ────────────────────────────────────────

describe("GET /api/v1/conversations/{id}/messages", () => {
  const list = (query = "", id = CONV_ID) => call(getMessages, { path: `/conversations/${id}/messages${query}`, params: { id } });
  const messagesChain = () => h.lastChain("chat_messages");

  it("devolve a página da mais nova para a mais antiga, no schema publicado, sem mídia nem metadata", async () => {
    const response = await list();
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(pageOf(conversationMessageSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(payload.data.map((message: { content: string }) => message.content)).toEqual([
      "mensagem 3",
      "mensagem 2",
      "mensagem 1",
    ]);
    expect(payload.meta).toEqual({ next_cursor: null });
    noSecrets(payload);

    const chain = messagesChain();
    expect(has(chain, "select", CONVERSATION_MESSAGE_SELECT)).toBe(true);
    expect(where(chain, "conversation_id", CONV_ID)).toBe(true);
    expect(has(chain, "order", "created_at", { ascending: false })).toBe(true);
    expect(has(chain, "order", "id", { ascending: false })).toBe(true);
    // A precedência importa: com o id na frente, o keyset do cursor pagina errado.
    expect(chain.filter(([method]) => method === "order").map(([, column]) => column)).toEqual(["created_at", "id"]);
    expect(has(chain, "limit", 51)).toBe(true);
  });

  it("a conversa é procurada pelo id da rota: é essa leitura que separa o 404", async () => {
    await list();

    const chain = h.lastChain("chat_conversations");
    expect(where(chain, "id", CONV_ID)).toBe(true);
    expect(has(chain, "maybeSingle")).toBe(true);
  });

  it("só lê: não zera as não lidas (a rota de sessão zera ao abrir a conversa)", async () => {
    expect((await list()).status).toBe(200);

    const methods = tableCalls("chat_conversations", "chat_messages").map(([method]) => method);
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.filter((method) => WRITES.includes(method))).toEqual([]);
    expect(rpcNames()).toEqual([]);
  });

  it("sem comments:read a nota interna fica de fora, e o corte é na consulta", async () => {
    await list();

    expect(has(messagesChain(), "neq", "type", "note")).toBe(true);
  });

  it.each([
    [["conversations:read"], false],
    [["conversations:read", "comments:read"], true],
    [["conversations:read", "comments:*"], true],
    // comments:write (o do preset da IA) escreve, mas não lê o que é do time.
    [["conversations:read", "comments:write"], false],
    [["conversations:*"], false],
    [["conversations:read", "tickets:*", "attachments:*"], false],
  ])("escopos %j: a nota interna entra? %s", async (scopes, notes) => {
    h.scopes = scopes;

    expect((await list()).status).toBe(200);
    expect(has(messagesChain(), "neq", "type", "note")).toBe(!notes);
  });

  it("com comments:read a nota interna entra, com o token que a escreveu", async () => {
    h.scopes = ["conversations:read", "comments:read"];
    h.tables.chat_messages = () => ({
      data: [
        messageRow(2, {
          direction: "outbound",
          sender_type: "ai",
          type: "note",
          content: "Cliente pediu um atendente",
          delivery_status: "sent",
          sent_by_token_id: "tok-9",
        }),
        messageRow(1),
      ],
      error: null,
    });

    const payload = await json(await list());

    expect(messagesChain().some(([method]) => method === "neq")).toBe(false);
    expect(payload.data[0]).toMatchObject({ type: "note", sender_type: "ai", sent_by_token_id: "tok-9", sent_by_user_id: null });
  });

  it("limit corta a página, e o next_cursor é a última mensagem devolvida", async () => {
    const response = await list("?limit=2");
    const payload = await json(response);

    expect(has(messagesChain(), "limit", 3)).toBe(true);
    expect(payload.data).toHaveLength(2);
    expect(decodeMessageCursor(payload.meta.next_cursor)).toEqual({
      createdAt: messageRow(2).created_at,
      id: messageRow(2).id,
    });
  });

  it("página cheia sem linha excedente não tem próxima", async () => {
    const payload = await json(await list("?limit=3"));

    expect(payload.data).toHaveLength(3);
    expect(payload.meta.next_cursor).toBeNull();
  });

  it("o cursor pede as mensagens anteriores a ele", async () => {
    const cursor = { createdAt: messageRow(2).created_at, id: messageRow(2).id };

    await list(`?cursor=${encodeMessageCursor(messageRow(2))}`);

    expect(has(messagesChain(), "or", olderThanFilter(cursor))).toBe(true);
  });

  it.each([
    ["lixo", "abc"],
    ["cursor de outra lista (cadastros)", encodeCursor({ updated_at: PAST, id: CONV_ID })],
    ["vazio", ""],
  ])("cursor inválido (%s) é 400 no campo, sem ler mensagens", async (_label, cursor) => {
    const response = await list(`?cursor=${cursor}`);

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toMatchObject({
      cursor: "Cursor inválido. Use o next_cursor da página anterior.",
    });
    expect(h.chains.chat_messages).toBeUndefined();
  });

  it.each(["0", "201", "abc", "-1"])("limit=%s é 400 no campo, sem ler mensagens", async (limit) => {
    const response = await list(`?limit=${limit}`);

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toEqual({ limit: "Use um número de 1 a 200." });
    expect(h.chains.chat_messages).toBeUndefined();
  });

  it.each([
    ["include_archived", "true"],
    ["updated_since", "2026-09-29T12:00:00Z"],
    ["q", "oi"],
  ])("parâmetro de outra lista (%s) é 400 no próprio nome, não ignorado", async (name, value) => {
    const response = await list(`?${name}=${value}`);

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields).toEqual({ [name]: "Campo não aceito." });
    expect(h.chains.chat_messages).toBeUndefined();
  });

  it("conversa que não existe é 404, mesmo sem mensagens", async () => {
    h.tables.chat_conversations = () => ({ data: null, error: null });
    h.tables.chat_messages = () => ({ data: [], error: null });

    const response = await list();

    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe("not_found");
  });

  it("conversa sem mensagens é 200 com a página vazia", async () => {
    h.tables.chat_messages = () => ({ data: [], error: null });

    const response = await list();

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true, data: [], meta: { next_cursor: null } });
  });

  it.each([
    ["das mensagens", "chat_messages"],
    ["da conversa", "chat_conversations"],
  ])("leitura %s que falhou é 503 com Retry-After e log, nunca página vazia", async (_label, table) => {
    h.tables[table] = dbError;
    const log = silence();

    const response = await list();
    const payload = await json(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(payload.error.code).toBe("unavailable");
    noSecrets(payload);
    expect(logged(log, payload)).toBe(true);
  });

  it("mensagem com remetente fora do vocabulário é 503, não some da lista", async () => {
    h.tables.chat_messages = () => ({ data: [messageRow(1, { sender_type: "robô" })], error: null });
    silence();

    expect((await list()).status).toBe(503);
  });

  it("id malformado é 404 sem tocar o banco das conversas", async () => {
    const response = await list("", "nao-e-uuid");

    expect(response.status).toBe(404);
    expect(h.chains.chat_conversations).toBeUndefined();
    expect(h.chains.chat_messages).toBeUndefined();
  });

  it("exige conversations:read", async () => {
    h.scopes = ["comments:read", "tickets:read"];

    expect((await list()).status).toBe(403);
    expect(h.chains.chat_messages).toBeUndefined();
  });
});

// ─── POST /conversations/{id}/handoff ────────────────────────────────────────

describe("POST /api/v1/conversations/{id}/handoff", () => {
  const handoff = (body: unknown, id = CONV_ID, headers: Record<string, string> = { "idempotency-key": "handoff-0001" }) =>
    call(postHandoff, { method: "POST", body, headers, params: { id } });

  it("passa a conversa com o token como ator e devolve o resultado do pedido, no schema publicado", async () => {
    const response = await handoff({
      reason: "  Cliente pediu um atendente  ",
      summary: "  Recebeu dois boletos no mês.  ",
      ticket_id: TICKET_ID,
    });
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(itemOf(handoffResultSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(payload.data).toEqual({
      conversation_id: CONV_ID,
      status: "human",
      changed: true,
      ticket_id: TICKET_ID,
      note_id: NOTE_ID,
    });
    expect(sent("conversation_handoff")).toEqual({
      p_conversation_id: CONV_ID,
      p_actor_token_id: "tok-1",
      p_reason: "Cliente pediu um atendente",
      p_summary: "Recebeu dois boletos no mês.",
      p_ticket_id: TICKET_ID,
    });
    noSecrets(payload);
    expect(rpcNames()).toContain("api_idempotency_finish");
  });

  it("não lê a conversa: conversations:handoff não dá a leitura dela", async () => {
    h.scopes = ["conversations:handoff"];

    const response = await handoff({ reason: "Motivo" });
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(Object.keys(payload.data).sort()).toEqual(["changed", "conversation_id", "note_id", "status", "ticket_id"]);
    expect(h.chains.chat_conversations).toBeUndefined();
    expect(h.chains.chat_messages).toBeUndefined();
  });

  it("o corpo guardado para a repetição é o mesmo da resposta, sem o telefone", async () => {
    const response = await handoff({ reason: "Motivo" });
    const payload = await json(response);
    const stored = rpcArgs("api_idempotency_finish");

    expect(stored).toMatchObject({ p_status: 200, p_body: payload });
    noSecrets(stored);
  });

  it("avisa o agente quando a conversa passou a human, e só então", async () => {
    await handoff({ reason: "Motivo" });
    expect(pushTakeoverMock).toHaveBeenCalledTimes(1);
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);

    pushTakeoverMock.mockClear();
    h.rpcs.conversation_handoff = () => ({
      data: handoffData({ changed: false, ticket_id: null, note_id: null }),
      error: null,
    });
    const response = await handoff({ reason: "De novo" }, CONV_ID, { "idempotency-key": "handoff-0002" });
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({
      conversation_id: CONV_ID,
      status: "human",
      changed: false,
      ticket_id: null,
      note_id: null,
    });
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it.each([
    ["sem resumo nem ticket", { reason: "Motivo" }],
    ["resumo e ticket nulos", { reason: "Motivo", summary: null, ticket_id: null }],
    ["resumo só de espaços", { reason: "Motivo", summary: "   " }],
  ])("%s: a RPC recebe só o motivo", async (_label, body) => {
    const response = await handoff(body);

    expect(response.status).toBe(200);
    expect(sent("conversation_handoff")).toEqual({
      p_conversation_id: CONV_ID,
      p_actor_token_id: "tok-1",
      p_reason: "Motivo",
    });
  });

  it.each([
    ["sem motivo", { summary: "x" }, "reason", "Informe o motivo."],
    ["motivo em branco", { reason: "   " }, "reason", "Informe o motivo."],
    ["motivo que não é texto", { reason: 5 }, "reason", "Informe o motivo."],
    ["motivo acima de 500", { reason: "m".repeat(501) }, "reason", "Máximo de 500 caracteres."],
    ["motivo com NUL", { reason: "a\u0000b" }, "reason", "Remova os caracteres inválidos."],
    ["resumo acima de 4.000", { reason: "Motivo", summary: "r".repeat(4001) }, "summary", "Máximo de 4.000 caracteres."],
    ["resumo que não é texto", { reason: "Motivo", summary: 5 }, "summary", "Resumo inválido."],
    ["resumo com NUL", { reason: "Motivo", summary: "a\u0000b" }, "summary", "Remova os caracteres inválidos."],
    ["ticket que não é uuid", { reason: "Motivo", ticket_id: "1024" }, "ticket_id", "Ticket inválido."],
    ["ticket vazio", { reason: "Motivo", ticket_id: "" }, "ticket_id", "Ticket inválido."],
    ["campo a mais (o ator não vem do corpo)", { reason: "Motivo", token_id: "x" }, "token_id", "Campo não aceito."],
    ["corpo que não é objeto", ["Motivo"], "body", "Envie um objeto JSON."],
  ])("%s é 400 no campo, sem chamar a RPC", async (_label, body, field, message) => {
    const response = await handoff(body);
    const payload = await json(response);

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_error");
    expect(payload.error.fields).toMatchObject({ [field]: message });
    expect(rpcNames()).not.toContain("conversation_handoff");
  });

  it("motivo de 500 e resumo de 4.000 caracteres passam", async () => {
    const response = await handoff({ reason: "ç".repeat(500), summary: "é".repeat(4000) });

    expect(response.status).toBe(200);
    expect(sent("conversation_handoff")).toMatchObject({ p_reason: "ç".repeat(500), p_summary: "é".repeat(4000) });
  });

  it("corpo vazio é 400 invalid_json", async () => {
    const response = await call(postHandoff, {
      method: "POST",
      rawBody: "",
      headers: { "idempotency-key": "handoff-0003" },
      params: { id: CONV_ID },
    });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_json");
    expect(rpcNames()).not.toContain("conversation_handoff");
  });

  it("id malformado é 404 sem chamar a RPC", async () => {
    const response = await handoff({ reason: "Motivo" }, "nao-e-uuid");

    expect(response.status).toBe(404);
    expect((await json(response)).error).toMatchObject({ code: "not_found", message: "Conversa não encontrada." });
    expect(rpcNames()).not.toContain("conversation_handoff");
  });

  it("conversa resolvida é 409 conversation_not_owned_by_ai, com o dono atual", async () => {
    h.rpcs.conversation_handoff = rpcError("CONVERSATION_NOT_OWNED_BY_AI", { hint: "resolved" });

    const response = await handoff({ reason: "Motivo" });
    const payload = await json(response);

    expect(response.status).toBe(409);
    expect(payload.error).toMatchObject({
      code: "conversation_not_owned_by_ai",
      message: "A conversa não está com a IA.",
      current: "resolved",
    });
    expect(pushTakeoverMock).not.toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");
  });

  it.each([
    ["CONVERSATION_NOT_FOUND", 404, "not_found"],
    ["TICKET_TERMINAL", 409, "ticket_terminal"],
    ["FORBIDDEN", 403, "forbidden"],
    ["INVALID_HANDOFF", 400, "validation_error"],
  ])("%s da RPC vira %i %s, e a chave é liberada", async (tag, status, code) => {
    h.rpcs.conversation_handoff = rpcError(tag);

    const response = await handoff({ reason: "Motivo" });

    expect(response.status).toBe(status);
    expect((await json(response)).error.code).toBe(code);
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("ticket de outra conversa é 422 no campo ticket_id, e fica guardado para a repetição", async () => {
    h.rpcs.conversation_handoff = rpcError("TICKET_NOT_IN_CONVERSATION");

    const response = await handoff({ reason: "Motivo", ticket_id: TICKET_ID });
    const payload = await json(response);

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("ticket_not_in_conversation");
    expect(payload.error.fields).toHaveProperty("ticket_id");
    expect(rpcArgs("api_idempotency_finish")).toMatchObject({ p_status: 422 });
  });

  it("erro sem TAG é 500 sem a mensagem do banco, e a chave é liberada", async () => {
    h.rpcs.conversation_handoff = () => ({ data: null, error: { message: "segredo do banco", code: "XX000" } });
    const logged = silence();

    const response = await handoff({ reason: "Motivo" });
    const payload = await json(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("internal_error");
    expect(payload.request_id).toEqual(expect.any(String));
    noSecrets(payload);
    expect(logged).toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("retorno da RPC fora do formato é 500, mas o agente já foi avisado do handoff gravado", async () => {
    h.rpcs.conversation_handoff = () => ({ data: handoffData({ ticket_id: "não-é-uuid" }), error: null });
    const logged = silence();

    const response = await handoff({ reason: "Motivo" });

    expect(response.status).toBe(500);
    expect(pushTakeoverMock).toHaveBeenCalledWith(EXTERNAL_ID, true);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(EXTERNAL_ID);
    noSecrets(await json(response));
  });

  it("a mesma Idempotency-Key repete a resposta guardada sem chamar a RPC", async () => {
    const stored = { ok: true, data: { conversation_id: CONV_ID, status: "human", changed: true, ticket_id: null, note_id: NOTE_ID } };
    h.rpcs.api_idempotency_begin = () => ({ data: { outcome: "replay", status: 200, body: stored }, error: null });

    const response = await handoff({ reason: "Motivo" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await json(response)).toEqual(stored);
    expect(rpcNames()).not.toContain("conversation_handoff");
    expect(pushTakeoverMock).not.toHaveBeenCalled();
  });

  it("exige Idempotency-Key e conversations:handoff", async () => {
    expect((await handoff({ reason: "Motivo" }, CONV_ID, {})).status).toBe(400);
    expect(rpcNames()).not.toContain("conversation_handoff");

    h.scopes = ["conversations:read", "messages:send", "tickets:write"];
    const response = await handoff({ reason: "Motivo" });

    expect(response.status).toBe(403);
    expect((await json(response)).error.required).toEqual(["conversations:handoff"]);
    expect(rpcNames()).not.toContain("conversation_handoff");
    expect(rpcNames()).not.toContain("api_idempotency_begin");
  });

  it("token de integração (api) também passa a conversa", async () => {
    h.actorType = "api";

    const response = await handoff({ reason: "Motivo" });

    expect(response.status).toBe(200);
    expect(sent("conversation_handoff")).toMatchObject({ p_actor_token_id: "tok-1" });
  });
});

// ─── PUT /conversations/{id}/active-ticket ───────────────────────────────────

describe("PUT /api/v1/conversations/{id}/active-ticket", () => {
  const focus = (body: unknown, id = CONV_ID) => call(putActiveTicket, { method: "PUT", body, params: { id } });

  it("põe o ticket em foco com o token como ator e devolve o foco que ficou, no schema publicado", async () => {
    const response = await focus({ ticket_id: TICKET_ID });
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(itemOf(activeTicketResultSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(payload.data).toEqual({ conversation_id: CONV_ID, active_ticket_id: TICKET_ID, changed: true });
    expect(sent("ticket_set_active")).toEqual({
      p_actor_token_id: "tok-1",
      p_conversation_id: CONV_ID,
      p_ticket_id: TICKET_ID,
    });
    noSecrets(payload);
  });

  it("não lê a conversa: tickets:write não dá a leitura dela", async () => {
    h.scopes = ["tickets:write"];

    const response = await focus({ ticket_id: TICKET_ID });

    expect(response.status).toBe(200);
    expect(h.chains.chat_conversations).toBeUndefined();
  });

  it("ticket_id null tira o foco (a chave some: vale o default da RPC)", async () => {
    h.rpcs.ticket_set_active = () => ({ data: { active_ticket_id: null, changed: true }, error: null });

    const response = await focus({ ticket_id: null });

    expect(response.status).toBe(200);
    expect((await json(response)).data).toEqual({ conversation_id: CONV_ID, active_ticket_id: null, changed: true });
    expect(sent("ticket_set_active")).toEqual({ p_actor_token_id: "tok-1", p_conversation_id: CONV_ID });
  });

  it("o mesmo foco de novo é 200 com changed=false", async () => {
    h.rpcs.ticket_set_active = () => ({ data: { active_ticket_id: TICKET_ID, changed: false }, error: null });

    expect((await json(await focus({ ticket_id: TICKET_ID }))).data).toEqual({
      conversation_id: CONV_ID,
      active_ticket_id: TICKET_ID,
      changed: false,
    });
  });

  it("o foco devolvido é o da RPC, não o do pedido", async () => {
    const other = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
    h.rpcs.ticket_set_active = () => ({ data: { active_ticket_id: other, changed: true }, error: null });

    expect((await json(await focus({ ticket_id: TICKET_ID }))).data.active_ticket_id).toBe(other);
  });

  it("não pede Idempotency-Key (PUT é idempotente)", async () => {
    const response = await focus({ ticket_id: TICKET_ID });

    expect(response.status).toBe(200);
    expect(rpcNames()).not.toContain("api_idempotency_begin");
  });

  it.each([
    ["sem ticket_id", {}, "ticket_id", "Ticket inválido."],
    ["ticket vazio", { ticket_id: "" }, "ticket_id", "Ticket inválido."],
    ["protocolo no lugar do uuid", { ticket_id: "1024" }, "ticket_id", "Ticket inválido."],
    ["campo a mais", { ticket_id: null, conversation_id: CONV_ID }, "conversation_id", "Campo não aceito."],
    ["corpo que não é objeto", null, "body", "Envie um objeto JSON."],
  ])("%s é 400 no campo, sem chamar a RPC", async (_label, body, field, message) => {
    const response = await focus(body);
    const payload = await json(response);

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_error");
    expect(payload.error.fields).toMatchObject({ [field]: message });
    expect(rpcNames()).not.toContain("ticket_set_active");
  });

  it("JSON inválido é 400 invalid_json", async () => {
    const response = await call(putActiveTicket, { method: "PUT", rawBody: "{", params: { id: CONV_ID } });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_json");
    expect(rpcNames()).not.toContain("ticket_set_active");
  });

  it.each([
    ["TICKET_NOT_IN_CONVERSATION", 422, "ticket_not_in_conversation"],
    ["TICKET_TERMINAL", 409, "ticket_terminal"],
    ["CONVERSATION_NOT_FOUND", 404, "not_found"],
    ["FORBIDDEN", 403, "forbidden"],
  ])("%s da RPC vira %i %s", async (tag, status, code) => {
    h.rpcs.ticket_set_active = rpcError(tag);

    const response = await focus({ ticket_id: TICKET_ID });

    expect(response.status).toBe(status);
    expect((await json(response)).error.code).toBe(code);
  });

  it("ticket de outra conversa marca o campo ticket_id", async () => {
    h.rpcs.ticket_set_active = rpcError("TICKET_NOT_IN_CONVERSATION");

    expect((await json(await focus({ ticket_id: TICKET_ID }))).error.fields).toHaveProperty("ticket_id");
  });

  it("erro sem TAG é 500 sem a mensagem do banco", async () => {
    h.rpcs.ticket_set_active = () => ({ data: null, error: { message: "segredo do banco", code: "XX000" } });
    const logged = silence();

    const response = await focus({ ticket_id: TICKET_ID });
    const payload = await json(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("internal_error");
    noSecrets(payload);
    expect(logged).toHaveBeenCalled();
  });

  it("id malformado é 404 sem chamar a RPC", async () => {
    const response = await focus({ ticket_id: TICKET_ID }, "nao-e-uuid");

    expect(response.status).toBe(404);
    expect(rpcNames()).not.toContain("ticket_set_active");
  });

  it("exige tickets:write (o foco é escrita de ticket)", async () => {
    h.scopes = ["conversations:read", "conversations:handoff", "tickets:read"];

    const response = await focus({ ticket_id: TICKET_ID });

    expect(response.status).toBe(403);
    expect((await json(response)).error.required).toEqual(["tickets:write"]);
    expect(rpcNames()).not.toContain("ticket_set_active");
  });
});

// ─── Contrato publicado ──────────────────────────────────────────────────────

describe("OpenAPI das conversas", () => {
  it("os componentes publicados são os schemas com que as rotas respondem e validam", () => {
    const { schemas } = buildOpenApiDocument().components;

    expect(schemas.Conversation).toEqual(z.toJSONSchema(itemOf(conversationDetailSchema)));
    expect(schemas.ConversationMessagePage).toEqual(z.toJSONSchema(pageOf(conversationMessageSchema)));
    expect(schemas.Handoff).toEqual(z.toJSONSchema(handoffBodySchema, { io: "input" }));
    expect(schemas.HandoffResult).toEqual(z.toJSONSchema(itemOf(handoffResultSchema)));
    expect(schemas.ActiveTicket).toEqual(z.toJSONSchema(activeTicketBodySchema, { io: "input" }));
    expect(schemas.ActiveTicketResult).toEqual(z.toJSONSchema(itemOf(activeTicketResultSchema)));
  });
});
