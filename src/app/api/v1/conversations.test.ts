// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { adminClientMock, pushTakeoverMock, sendTextMock, credentialsMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  pushTakeoverMock: vi.fn(),
  sendTextMock: vi.fn(),
  credentialsMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));
vi.mock("@/features/chat/lib/push-takeover", () => ({ pushTakeoverToAgent: pushTakeoverMock }));
// O provedor e a credencial são SEMPRE de mentira: nenhum teste fala com o WhatsApp.
vi.mock("@/features/chat/lib/senders/uazapi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chat/lib/senders/uazapi")>()),
  sendUazapiText: sendTextMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({ getIntegrationCredentials: credentialsMock }));

import { PUT as putActiveTicket } from "@/app/api/v1/conversations/[id]/active-ticket/route";
import { POST as postHandoff } from "@/app/api/v1/conversations/[id]/handoff/route";
import { GET as getMessages, POST as postMessage } from "@/app/api/v1/conversations/[id]/messages/route";
import { GET as getConversation } from "@/app/api/v1/conversations/[id]/route";
import { UnsafeUrlError } from "@/lib/security/ssrf-guard";
import { olderThanFilter } from "@/features/chat/lib/messages-page";
import { UazapiHttpError } from "@/features/chat/lib/senders/uazapi";
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
  MESSAGES_PER_CONVERSATION_PER_HOUR,
  MESSAGES_PER_CONVERSATION_PER_MIN,
  messageSendBodySchema,
} from "@/lib/api/v1/conversations";
import { decodeMessageCursor, encodeCursor, encodeMessageCursor } from "@/lib/api/v1/cursor";
import { sha256Hex } from "@/lib/api/v1/idempotency";
import { buildOpenApiDocument } from "@/lib/api/v1/openapi";

import { createHarness, has, where, type Call, type Responder } from "./test-harness";

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
  integration_id: "integration-1",
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
  sendTextMock.mockResolvedValue({ id: "uazapi-1", messageid: "provider-1" });
  credentialsMock.mockResolvedValue({ id: "integration-1", apiUrl: "https://api.uazapi.test", token: "segredo-da-instancia", phone_number: null });
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

// ─── POST /conversations/{id}/messages ───────────────────────────────────────

describe("POST /api/v1/conversations/{id}/messages", () => {
  const KEY = "envio-0001";
  const clientIdOf = (key: string, tokenId = "tok-1") => `k${sha256Hex(`${tokenId}:${key}`).slice(0, 40)}`;
  // Uma conversa por caso: o teto de mensagens por conversa é por processo, e
  // os casos deste bloco somariam todos na mesma.
  let conv = CONV_ID;
  let serial = 0;
  // Todo status que a rota devolve nos casos deste bloco está no contrato publicado.
  const documented = Object.keys(buildOpenApiDocument().paths["/conversations/{id}/messages"].post.responses);
  const send = async (body: unknown, id = conv, headers: Record<string, string> = { "idempotency-key": KEY }) => {
    const response = await call(postMessage, { method: "POST", body, headers, params: { id } });
    expect(documented, `status ${response.status} fora do OpenAPI`).toContain(
      response.status === 500 ? "default" : String(response.status)
    );
    return response;
  };

  const sentRow = (overrides: Record<string, unknown> = {}) =>
    messageRow(7, {
      direction: "outbound",
      sender_type: "ai",
      content: "Olá, sou a assistente.",
      delivery_status: "sent",
      sent_by_token_id: "tok-1",
      external_id: "provider-1",
      metadata: { clientId: clientIdOf(KEY) },
      ...overrides,
    });

  // O banco da rota de envio: cada consulta é reconhecida pela cadeia.
  type MessagesDb = {
    existing?: unknown;
    /** As buscas pela chave, na ordem (quem perde a corrida relê depois do INSERT). */
    lookups?: unknown[];
    inserted?: unknown;
    insertError?: { message: string; code?: string };
    updated?: unknown;
    final?: unknown;
    /** A gravação do resultado do provedor LANÇA, em vez de devolver erro. */
    bookkeepingThrows?: boolean;
  };
  const messagesDb = (state: MessagesDb = {}): Responder => {
    const lookups = [...(state.lookups ?? [])];
    return (calls) => {
      if (calls.some(([method]) => method === "insert")) {
        return { data: state.insertError ? null : (state.inserted ?? sentRow({ delivery_status: "pending", external_id: null })), error: state.insertError ?? null };
      }
      const update = calls.find(([method]) => method === "update")?.[1] as Record<string, unknown> | undefined;
      if (update) {
        if (state.bookkeepingThrows && "external_id" in update) throw new Error("rede do banco caiu");
        return { data: state.updated ?? null, error: null };
      }
      if (calls.some(([method, column]) => method === "eq" && column === "metadata->>clientId")) {
        return { data: state.lookups ? (lookups.shift() ?? null) : (state.existing ?? null), error: null };
      }
      return { data: state.final ?? sentRow(), error: null };
    };
  };
  const chainsWith = (method: string) => (h.chains.chat_messages ?? []).filter((chain) => chain.some(([name]) => name === method));
  const insertPayload = () => chainsWith("insert")[0]?.find(([name]) => name === "insert")?.[1] as Record<string, unknown> | undefined;
  const markedFailed = () => chainsWith("update").some((chain) => has(chain, "update", { delivery_status: "failed" }));
  const wroteNothing = () => chainsWith("insert").length === 0 && chainsWith("update").length === 0;
  // A leitura do dono da conversa, feita na hora do envio.
  const isStatusRead = (calls: Call[]) => has(calls, "select", "status");
  const statusReads = () => (h.chains.chat_conversations ?? []).filter(isStatusRead);
  const networkError = (code: string) =>
    Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

  beforeEach(() => {
    serial += 1;
    conv = `1a2b3c4d-5e6f-4a7b-8c9d-${String(serial).padStart(12, "0")}`;
    h.scopes = ["messages:send"];
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv }), error: null });
    h.tables.chat_messages = messagesDb();
  });

  it("a IA envia na conversa que é dela: grava com o token como autor, manda ao provedor e devolve 201 no schema publicado", async () => {
    const response = await send({ text: "  Olá, sou a assistente.  " });
    const payload = await json(response);

    expect(response.status).toBe(201);
    expect(itemOf(conversationMessageSchema).safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(payload.data).toMatchObject({
      direction: "outbound",
      sender_type: "ai",
      type: "text",
      content: "Olá, sou a assistente.",
      delivery_status: "sent",
      sent_by_token_id: "tok-1",
      sent_by_user_id: null,
    });
    noSecrets(payload);
    expect(JSON.stringify(payload)).not.toContain("segredo-da-instancia");

    const inserted = insertPayload();
    expect(inserted).toEqual({
      conversation_id: conv,
      direction: "outbound",
      sender_type: "ai",
      type: "text",
      content: "Olá, sou a assistente.",
      quoted_message_id: null,
      metadata: { clientId: clientIdOf(KEY) },
      delivery_status: "pending",
      sent_by_token_id: "tok-1",
      created_at: expect.any(String),
    });
    expect(inserted).not.toHaveProperty("sent_by_user_id");

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).toHaveBeenCalledWith("https://api.uazapi.test", "segredo-da-instancia", EXTERNAL_ID, "Olá, sou a assistente.", {
      trackId: messageRow(7).id,
      replyId: null,
    });
    expect(credentialsMock).toHaveBeenCalledWith(expect.anything(), "integration-1");
    expect(rpcArgs("api_idempotency_finish")).toMatchObject({ p_status: 201, p_body: payload });
  });

  it("o CRM não assina o texto: vai ao cliente como a IA escreveu", async () => {
    await send({ text: "Bom dia!\nPosso ajudar?" });

    expect(sendTextMock.mock.calls[0]?.[3]).toBe("Bom dia!\nPosso ajudar?");
    expect(insertPayload()?.content).toBe("Bom dia!\nPosso ajudar?");
  });

  it("lê da conversa só o que o envio precisa, pelo id da rota", async () => {
    await send({ text: "Olá" });

    const chain = h.chains.chat_conversations?.[0] ?? [];
    expect(has(chain, "select", "id, external_id, contact_phone, integration_id")).toBe(true);
    expect(where(chain, "id", conv)).toBe(true);
    expect(has(chain, "maybeSingle")).toBe(true);
  });

  // ── o dono da conversa ──────────────────────────────────────────────────────

  it.each([
    ["human", "um analista está atendendo"],
    ["resolved", "a conversa foi encerrada"],
  ])("a IA não envia em conversa %s (%s): 409 com o dono atual, sem gravar nem mandar", async (status) => {
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv, status }), error: null });

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(409);
    expect(payload.error).toMatchObject({ code: "conversation_not_owned_by_ai", message: "A conversa não está com a IA.", current: status });
    expect(wroteNothing()).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("status fora do vocabulário barra a IA sem publicar o valor em current", async () => {
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv, status: "pausada" }), error: null });

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("conversation_not_owned_by_ai");
    expect(payload.error).not.toHaveProperty("current");
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("o dono é lido na hora de enviar, depois de tudo: o analista que assume no meio do caminho barra a IA", async () => {
    // A 1ª leitura ainda vê `bot`; quando a mensagem vai sair, já é `human`.
    h.tables.chat_conversations = (calls) => ({
      data: conversationRow({ id: conv, status: isStatusRead(calls) ? "human" : "bot" }),
      error: null,
    });

    const response = await send({ text: "Olá" });

    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({ code: "conversation_not_owned_by_ai", current: "human" });
    expect(wroteNothing()).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();

    const [read] = statusReads();
    expect(statusReads()).toHaveLength(1);
    expect(where(read ?? [], "id", conv)).toBe(true);
    expect(has(read ?? [], "maybeSingle")).toBe(true);
    // A conferência vem depois da busca pela chave e antes de gravar.
    expect(chainsWith("eq")).toHaveLength(1);
  });

  it("vale o dono lido na hora de enviar, e não o da leitura inicial", async () => {
    h.tables.chat_conversations = (calls) => ({
      data: conversationRow({ id: conv, status: isStatusRead(calls) ? "bot" : "human" }),
      error: null,
    });

    expect((await send({ text: "Olá" })).status).toBe(201);
  });

  it("dono que não se consegue ler é 503, e conversa que sumiu é 404: nada sai", async () => {
    const log = silence();
    h.tables.chat_conversations = (calls) =>
      isStatusRead(calls) ? dbError(calls) : { data: conversationRow({ id: conv }), error: null };

    const failed = await send({ text: "Olá" });
    const payload = await json(failed);
    expect(failed.status).toBe(503);
    expect(payload.error.code).toBe("unavailable");
    noSecrets(payload);
    expect(logged(log, payload)).toBe(true);

    h.tables.chat_conversations = (calls) => ({ data: isStatusRead(calls) ? null : conversationRow({ id: conv }), error: null });
    const gone = await send({ text: "Olá" }, conv, { "idempotency-key": "envio-0002" });
    expect(gone.status).toBe(404);

    expect(wroteNothing()).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("token de integração envia como system, mesmo com um analista atendendo, e nem lê o dono", async () => {
    h.actorType = "api";
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv, status: "human" }), error: null });
    h.tables.chat_messages = messagesDb({ final: sentRow({ sender_type: "system" }) });

    const response = await send({ text: "Seu boleto vence amanhã." });

    expect(response.status).toBe(201);
    expect(insertPayload()).toMatchObject({ sender_type: "system", sent_by_token_id: "tok-1" });
    expect((await json(response)).data.sender_type).toBe("system");
    expect(statusReads()).toEqual([]);
  });

  // ── a mesma chave ───────────────────────────────────────────────────────────

  it("a chave de envio sai da Idempotency-Key e do token: a mesma chave acha a mesma linha", async () => {
    await send({ text: "Olá" });
    const first = chainsWith("eq")[0] ?? [];

    expect(where(first, "conversation_id", conv)).toBe(true);
    expect(where(first, "metadata->>clientId", clientIdOf(KEY))).toBe(true);
    expect(clientIdOf(KEY)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(clientIdOf(KEY)).not.toBe(clientIdOf("envio-0002"));
    expect(clientIdOf(KEY)).not.toBe(clientIdOf(KEY, "tok-2"));
  });

  it.each(["sent", "delivered", "read"])(
    "a mesma chave de uma mensagem %s devolve a mesma mensagem com 200, sem gravar nem mandar de novo",
    async (status) => {
      h.tables.chat_messages = messagesDb({ existing: sentRow({ delivery_status: status }) });

      const response = await send({ text: "Olá, sou a assistente." });
      const payload = await json(response);

      expect(response.status).toBe(200);
      expect(payload.data).toMatchObject({ id: messageRow(7).id, delivery_status: status });
      expect(wroteNothing()).toBe(true);
      expect(sendTextMock).not.toHaveBeenCalled();
      expect(rpcArgs("api_idempotency_finish")).toMatchObject({ p_status: 200 });
    }
  );

  it("repetir a chave de uma mensagem que já saiu não esbarra no dono da conversa nem gasta o teto", async () => {
    // A IA enviou e o analista assumiu depois: a repetição ainda acha a mensagem.
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv, status: "human" }), error: null });
    h.tables.chat_messages = messagesDb({ existing: sentRow() });

    for (let n = 1; n <= MESSAGES_PER_CONVERSATION_PER_MIN + 5; n += 1) {
      expect((await send({ text: "Olá, sou a assistente." })).status, `repetição ${n}`).toBe(200);
    }
    expect(statusReads()).toEqual([]);

    // O teto segue inteiro para o que vai sair de verdade.
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv }), error: null });
    h.tables.chat_messages = messagesDb();
    expect((await send({ text: "Nova" }, conv, { "idempotency-key": "envio-0002" })).status).toBe(201);
  });

  it("a mesma chave de um envio que falhou reenvia a MESMA linha, com o texto dela", async () => {
    h.tables.chat_messages = messagesDb({
      existing: sentRow({ delivery_status: "failed", content: "Texto da 1ª tentativa", external_id: null }),
      updated: sentRow({ delivery_status: "pending", content: "Texto da 1ª tentativa", external_id: null }),
    });

    const response = await send({ text: "Texto da 1ª tentativa" });

    expect(response.status).toBe(201);
    expect(chainsWith("insert")).toEqual([]);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock.mock.calls[0]?.[3]).toBe("Texto da 1ª tentativa");
    const resend = chainsWith("update")[0] ?? [];
    expect(has(resend, "update", { delivery_status: "pending" })).toBe(true);
    // Só UM de dois reenvios simultâneos vira a linha.
    expect(where(resend, "delivery_status", "failed")).toBe(true);
  });

  it("o reenvio de uma falha também confere o dono e gasta o teto", async () => {
    h.tables.chat_conversations = (calls) => ({
      data: conversationRow({ id: conv, status: isStatusRead(calls) ? "human" : "bot" }),
      error: null,
    });
    h.tables.chat_messages = messagesDb({ existing: sentRow({ delivery_status: "failed", external_id: null }) });

    const response = await send({ text: "Olá, sou a assistente." });

    expect(response.status).toBe(409);
    expect(wroteNothing()).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it.each([
    ["que falhou", "failed"],
    ["de desfecho desconhecido", "pending"],
    ["que já saiu", "sent"],
  ])("a mesma chave com OUTRO texto, de uma mensagem %s, é 422: nada é reenviado nem devolvido como se fosse o novo", async (_label, status) => {
    h.tables.chat_messages = messagesDb({ existing: sentRow({ delivery_status: status, content: "Texto antigo" }) });

    const response = await send({ text: "Texto novo" });
    const payload = await json(response);

    expect(response.status).toBe(422);
    expect(payload.error).toMatchObject({
      code: "idempotency_key_reused",
      message: "Esta Idempotency-Key já foi usada nesta conversa para outra mensagem.",
    });
    expect(JSON.stringify(payload)).not.toContain("Texto antigo");
    expect(wroteNothing()).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(statusReads()).toEqual([]);
    // A recusa não toma a chave: o pedido com o texto original segue valendo.
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("o texto é comparado depois do trim, como foi gravado", async () => {
    h.tables.chat_messages = messagesDb({ existing: sentRow() });

    expect((await send({ text: "  Olá, sou a assistente.\n" })).status).toBe(200);
  });

  it.each([
    ["apagada pela tela", { is_deleted: true, content: null }],
    ["editada pela tela", { content: "Texto corrigido pelo analista", metadata: { clientId: clientIdOf(KEY), editedAt: "2026-09-29T12:05:00.000Z" } }],
  ])("mensagem %s já não guarda o texto original: a mesma chave a devolve, sem comparar nem reenviar", async (_label, overrides) => {
    h.tables.chat_messages = messagesDb({ existing: sentRow(overrides) });

    const response = await send({ text: "Olá, sou a assistente." });

    expect(response.status).toBe(200);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it.each(["failed", "pending", "sent"])(
    "mensagem apagada com status %s nunca é reenviada: a mesma chave a devolve como está",
    async (status) => {
      h.tables.chat_messages = messagesDb({
        existing: sentRow({ is_deleted: true, content: null, delivery_status: status }),
      });

      const response = await send({ text: "Olá, sou a assistente." });
      const payload = await json(response);

      expect(response.status).toBe(200);
      expect(payload.data).toMatchObject({ id: messageRow(7).id, is_deleted: true, content: null, delivery_status: status });
      expect(wroteNothing()).toBe(true);
      expect(sendTextMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["vazio", ""],
    ["nulo", null],
    ["que não é texto", 0],
  ])("editedAt %s não é edição: o texto segue sendo comparado", async (_label, editedAt) => {
    h.tables.chat_messages = messagesDb({
      existing: sentRow({ content: "Texto antigo", metadata: { clientId: clientIdOf(KEY), editedAt } }),
    });

    expect((await send({ text: "Texto novo" })).status).toBe(422);
  });

  it.each([
    ["de outro token", { sent_by_token_id: "tok-2" }],
    ["de um analista", { sent_by_token_id: null, sent_by_user_id: "user-1", sender_type: "agent" }],
  ])("chave que cai numa linha %s é 422: o token não devolve nem reenvia mensagem alheia", async (_label, overrides) => {
    for (const status of ["sent", "failed"]) {
      h.clearChains();
      h.tables.chat_messages = messagesDb({ existing: sentRow({ ...overrides, delivery_status: status }) });

      const response = await send({ text: "Olá, sou a assistente." });
      const payload = await json(response);

      expect(response.status, status).toBe(422);
      expect(payload.error.code).toBe("idempotency_key_reused");
      expect(JSON.stringify(payload)).not.toContain(messageRow(7).id);
      expect(wroteNothing()).toBe(true);
      expect(sendTextMock).not.toHaveBeenCalled();
    }
  });

  // ── no máximo uma vez ───────────────────────────────────────────────────────

  it.each([
    ["o provedor recusou o pedido (401)", () => new UazapiHttpError('uazapi /send/text 401: {"error":"Invalid token segredo-da-instancia"}', 401, null)],
    ["o provedor recusou o pedido (400)", () => new UazapiHttpError("uazapi /send/text 400: Missing number or text", 400, null)],
    ["o provedor limitou (429)", () => new UazapiHttpError("uazapi /send/text 429: Rate limit exceeded", 429, null)],
    ["o WhatsApp recusou a mensagem (500 com whatsapp_server)", () => new UazapiHttpError("uazapi /send/text 500: WhatsApp server error 463", 500, "whatsapp_server")],
    ["o provedor diz que não há sessão do WhatsApp (500)", () => new UazapiHttpError('uazapi /send/text 500: {"error":"No session"}', 500, null, "No session")],
    ["o nome do provedor não resolveu", () => networkError("ENOTFOUND")],
    ["a conexão foi recusada", () => networkError("ECONNREFUSED")],
    ["a conexão não abriu a tempo", () => networkError("UND_ERR_CONNECT_TIMEOUT")],
    ["o certificado do provedor venceu", () => networkError("CERT_HAS_EXPIRED")],
    ["a URL da integração não passou na guarda", () => new UnsafeUrlError("A URL aponta para um host de rede interna (bloqueado).")],
  ])("%s: a mensagem NÃO saiu — 502 whatsapp_unavailable, a linha vira failed e a chave é liberada para repetir", async (_label, error) => {
    sendTextMock.mockRejectedValue(error());
    const log = silence();

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(502);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(payload.error.code).toBe("whatsapp_unavailable");
    expect(payload.error.message).toContain("não saiu");
    expect(JSON.stringify(payload)).not.toContain("segredo-da-instancia");
    const failed = chainsWith("update").find((chain) => has(chain, "update", { delivery_status: "failed" })) ?? [];
    expect(where(failed, "id", messageRow(7).id)).toBe(true);
    // `failed` só sobrescreve `pending`: não apaga uma entrega que o webhook já confirmou.
    expect(has(failed, "in", "delivery_status", ["pending"])).toBe(true);
    expect(log).toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it.each([
    ["o provedor demorou além do limite", () => new DOMException("The operation was aborted due to timeout", "TimeoutError")],
    ["a conexão caiu no meio", () => networkError("UND_ERR_SOCKET")],
    ["a conexão foi reiniciada", () => networkError("ECONNRESET")],
    ["o provedor respondeu 500 genérico", () => new UazapiHttpError('uazapi /send/text 500: {"error":"Failed to send message"}', 500, null, "Failed to send message")],
    ["um proxy respondeu 502", () => new UazapiHttpError("uazapi /send/text 502: <html>Bad Gateway segredo-da-instancia</html>", 502, null)],
    ["um proxy respondeu 504", () => new UazapiHttpError("uazapi /send/text 504: ", 504, null)],
    ["a resposta veio ilegível", () => new TypeError("Cannot read properties of undefined")],
    ["a falha nem é um Error", () => "queda"],
  ])("%s: não se sabe se saiu — 504 delivery_unknown, a linha FICA pending e nada a marca como falha", async (_label, error) => {
    sendTextMock.mockRejectedValue(error());
    const log = silence();

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(504);
    expect(response.headers.get("Retry-After")).toBe("10");
    expect(payload.error.code).toBe("delivery_unknown");
    expect(payload.error.message).toContain("pode ter saído");
    expect(JSON.stringify(payload)).not.toContain("segredo-da-instancia");
    expect(chainsWith("insert")).toHaveLength(1);
    expect(chainsWith("update")).toEqual([]);
    expect(log).toHaveBeenCalled();
    // Nada é guardado: a repetição roda de novo e lê o que a linha virou.
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("a mesma chave de uma mensagem de desfecho desconhecido NUNCA manda de novo: 504 enquanto a linha está pending", async () => {
    h.tables.chat_messages = messagesDb({ existing: sentRow({ delivery_status: "pending", external_id: null }) });

    const response = await send({ text: "Olá, sou a assistente." });
    const payload = await json(response);

    expect(response.status).toBe(504);
    expect(payload.error.code).toBe("delivery_unknown");
    expect(wroteNothing()).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(statusReads()).toEqual([]);
    expect(rpcNames()).not.toContain("api_idempotency_finish");

    // O webhook confirmou a entrega: a mesma chave passa a responder a mensagem.
    h.tables.chat_messages = messagesDb({ existing: sentRow({ delivery_status: "delivered" }) });
    const later = await send({ text: "Olá, sou a assistente." });
    expect(later.status).toBe(200);
    expect((await json(later)).data.delivery_status).toBe("delivered");
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("o provedor aceitou e a NOSSA gravação lançou: 500, e a linha não vira failed (repetir não manda de novo)", async () => {
    h.tables.chat_messages = messagesDb({ bookkeepingThrows: true });
    const log = silence();

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("internal_error");
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(markedFailed()).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");
  });

  it.each([
    ["já falhou", "failed", 502, "whatsapp_unavailable"],
    ["ainda está enviando", "pending", 504, "delivery_unknown"],
  ])("perdeu a corrida para outro pedido da mesma chave, que %s: %d, sem mandar nem guardar um 200", async (_label, status, expected, code) => {
    h.tables.chat_messages = messagesDb({
      insertError: { message: "duplicate key value violates unique constraint", code: "23505" },
      lookups: [null, sentRow({ delivery_status: status, external_id: null })],
    });

    const response = await send({ text: "Olá, sou a assistente." });

    expect(response.status).toBe(expected);
    expect((await json(response)).error.code).toBe(code);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(chainsWith("update")).toEqual([]);
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("perdeu a corrida para um pedido que já enviou: 200 com a mesma mensagem", async () => {
    h.tables.chat_messages = messagesDb({
      insertError: { message: "duplicate key value violates unique constraint", code: "23505" },
      lookups: [null, sentRow()],
    });

    const response = await send({ text: "Olá, sou a assistente." });

    expect(response.status).toBe(200);
    expect((await json(response)).data.id).toBe(messageRow(7).id);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("perdeu a corrida do reenvio (outro pedido já virou a linha): não manda", async () => {
    h.tables.chat_messages = messagesDb({
      lookups: [sentRow({ delivery_status: "failed", external_id: null }), sentRow({ delivery_status: "pending", external_id: null })],
      updated: null,
    });

    const response = await send({ text: "Olá, sou a assistente." });

    expect(response.status).toBe(504);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  // ── o canal ─────────────────────────────────────────────────────────────────

  it.each([
    ["sem integração (WhatsApp nunca conectado ou excluído)", () => credentialsMock.mockResolvedValue(null)],
    [
      "sem endereço do canal",
      () => {
        h.tables.chat_conversations = () => ({
          data: conversationRow({ id: conv, external_id: null, contact_phone: null }),
          error: null,
        });
      },
    ],
  ])("%s é 409 channel_unavailable, sem gravar nem mandar", async (_label, arrange) => {
    arrange();

    const response = await send({ text: "Olá" });

    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe("channel_unavailable");
    expect(h.chains.chat_messages).toBeUndefined();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  // ── a entrada ───────────────────────────────────────────────────────────────

  it.each([
    ["sem texto", {}, "text", "Informe o texto."],
    ["texto em branco", { text: "   " }, "text", "Informe o texto."],
    ["texto que não é string", { text: 5 }, "text", "Informe o texto."],
    ["texto acima de 4.096", { text: "a".repeat(4097) }, "text", "Máximo de 4.096 caracteres."],
    ["texto com NUL", { text: "a\u0000b" }, "text", "Remova os caracteres inválidos."],
    ["remetente no corpo", { text: "Olá", sender_type: "agent" }, "sender_type", "Campo não aceito."],
    ["client_id no corpo (a chave é a Idempotency-Key)", { text: "Olá", client_id: "abc" }, "client_id", "Campo não aceito."],
    ["corpo que não é objeto", "Olá", "body", "Envie um objeto JSON."],
  ])("%s é 400 no campo, sem ler a conversa nem mandar", async (_label, body, field, message) => {
    const response = await send(body);
    const payload = await json(response);

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_error");
    expect(payload.error.fields).toMatchObject({ [field]: message });
    expect(h.chains.chat_conversations).toBeUndefined();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("texto de 4.096 caracteres passa", async () => {
    expect((await send({ text: "ç".repeat(4096) })).status).toBe(201);
  });

  it("conversa que não existe é 404; id malformado nem chega ao banco", async () => {
    h.tables.chat_conversations = () => ({ data: null, error: null });
    const missing = await send({ text: "Olá" });
    expect(missing.status).toBe(404);
    expect((await json(missing)).error).toMatchObject({ code: "not_found", message: "Conversa não encontrada." });

    h.clearChains();
    const malformed = await send({ text: "Olá" }, "nao-e-uuid", { "idempotency-key": "envio-0009" });
    expect(malformed.status).toBe(404);
    expect(h.chains.chat_conversations).toBeUndefined();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("leitura da conversa que falhou é 503, sem mandar", async () => {
    h.tables.chat_conversations = dbError;
    const log = silence();

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(payload.error.code).toBe("unavailable");
    noSecrets(payload);
    expect(log).toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("erro do banco ao gravar é 500 sem a mensagem dele, sem mandar, e a chave é liberada", async () => {
    h.tables.chat_messages = messagesDb({ insertError: { message: "INVALID_SENDER segredo do banco", code: "P0001" } });
    const log = silence();

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("internal_error");
    noSecrets(payload);
    expect(log).toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");
  });

  it("a mesma Idempotency-Key repete a resposta guardada sem ler a conversa nem mandar", async () => {
    const stored = { ok: true, data: { id: messageRow(7).id } };
    h.rpcs.api_idempotency_begin = () => ({ data: { outcome: "replay", status: 201, body: stored }, error: null });

    const response = await send({ text: "Olá" });

    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await json(response)).toEqual(stored);
    expect(h.chains.chat_conversations).toBeUndefined();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("exige Idempotency-Key e messages:send (ler a conversa não dá o envio)", async () => {
    expect((await send({ text: "Olá" }, conv, {})).status).toBe(400);
    expect(sendTextMock).not.toHaveBeenCalled();

    h.scopes = ["conversations:read", "conversations:handoff", "tickets:write", "comments:write"];
    const response = await send({ text: "Olá" });

    expect(response.status).toBe(403);
    expect((await json(response)).error.required).toEqual(["messages:send"]);
    expect(h.chains.chat_conversations).toBeUndefined();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  // ── os tetos ────────────────────────────────────────────────────────────────

  it("acima do teto por minuto é 429 com Retry-After, sem gravar nem mandar; outro token e outra conversa seguem", async () => {
    // O número é contrato: está no OpenAPI.
    expect(MESSAGES_PER_CONVERSATION_PER_MIN).toBe(20);
    for (let n = 1; n <= MESSAGES_PER_CONVERSATION_PER_MIN; n += 1) {
      const within = await send({ text: `mensagem ${n}` }, conv, { "idempotency-key": `teto-${String(n).padStart(4, "0")}` });
      expect(within.status, `mensagem ${n}`).toBe(201);
    }
    sendTextMock.mockClear();
    h.clearChains();

    const response = await send({ text: "uma a mais" }, conv, { "idempotency-key": "teto-9999" });
    const payload = await json(response);

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe("rate_limited");
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(wroteNothing()).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");

    // O teto é por token E por conversa: outro token na mesma conversa segue...
    const tokenRow = h.tables.api_tokens;
    h.tables.api_tokens = (calls) => {
      const result = tokenRow(calls);
      return { ...result, data: { ...(result.data as Record<string, unknown>), id: "tok-2" } };
    };
    h.tables.chat_messages = messagesDb({ final: sentRow({ sent_by_token_id: "tok-2" }) });
    expect((await send({ text: "de outro token" }, conv, { "idempotency-key": "teto-token2" })).status).toBe(201);
    h.tables.api_tokens = tokenRow;

    // ...e o mesmo token em outra conversa também.
    const other = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: other }), error: null });
    expect((await send({ text: "em outra conversa" }, other, { "idempotency-key": "teto-outra" })).status).toBe(201);
  });

  it("acima do teto por hora é 429 mesmo no ritmo que o do minuto deixa passar, e volta na hora seguinte", async () => {
    expect(MESSAGES_PER_CONVERSATION_PER_HOUR).toBe(100);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
      let n = 0;
      const next = () => {
        n += 1;
        return send({ text: `mensagem ${n}` }, conv, { "idempotency-key": `hora-${String(n).padStart(4, "0")}` });
      };
      // Vinte por minuto, minuto a minuto: o teto do minuto nunca barra.
      while (n < MESSAGES_PER_CONVERSATION_PER_HOUR) {
        if (n > 0 && n % MESSAGES_PER_CONVERSATION_PER_MIN === 0) {
          // O que o teto do minuto barra não gasta o da hora.
          for (let extra = 1; extra <= 30; extra += 1) {
            const blocked = await send({ text: "a mais" }, conv, { "idempotency-key": `extra-${n}-${extra}` });
            expect(blocked.status).toBe(429);
            expect(Number(blocked.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
          }
          vi.advanceTimersByTime(61_000);
        }
        expect((await next()).status, `mensagem ${n}`).toBe(201);
      }
      vi.advanceTimersByTime(61_000);
      sendTextMock.mockClear();
      h.clearChains();

      const response = await next();

      expect(response.status).toBe(429);
      expect((await json(response)).error.code).toBe("rate_limited");
      // É o teto da HORA que barra: a espera passa de um minuto.
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(60);
      expect(wroteNothing()).toBe(true);
      expect(sendTextMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3_600_000);
      expect((await next()).status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o que não chega a sair não gasta o teto: validação, conversa de outro dono e conversa inexistente", async () => {
    const many = MESSAGES_PER_CONVERSATION_PER_MIN + 5;
    for (let n = 1; n <= many; n += 1) {
      expect((await send({ text: "   " }, conv, { "idempotency-key": `nulo-${String(n).padStart(4, "0")}` })).status).toBe(400);
    }
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv, status: "human" }), error: null });
    for (let n = 1; n <= many; n += 1) {
      expect((await send({ text: "Olá" }, conv, { "idempotency-key": `dono-${String(n).padStart(4, "0")}` })).status).toBe(409);
    }
    h.tables.chat_conversations = () => ({ data: null, error: null });
    for (let n = 1; n <= many; n += 1) {
      expect((await send({ text: "Olá" }, conv, { "idempotency-key": `some-${String(n).padStart(4, "0")}` })).status).toBe(404);
    }
    h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv }), error: null });

    expect((await send({ text: "Olá" }, conv, { "idempotency-key": "agora-vai" })).status).toBe(201);
  });

  it("a tentativa que o provedor recusa gasta o teto: repetir uma falha não vira um laço sem freio", async () => {
    sendTextMock.mockRejectedValue(new UazapiHttpError("uazapi /send/text 401: Invalid token", 401, null));
    silence();
    for (let n = 1; n <= MESSAGES_PER_CONVERSATION_PER_MIN; n += 1) {
      expect((await send({ text: "Olá" }, conv, { "idempotency-key": `falha-${String(n).padStart(4, "0")}` })).status).toBe(502);
    }
    sendTextMock.mockClear();

    expect((await send({ text: "Olá" }, conv, { "idempotency-key": "falha-9999" })).status).toBe(429);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  // ── o que o envio grava, e o contrato publicado ─────────────────────────────

  it("depois do aceite do provedor: carimba o id dele e vira sent só a partir de pending, sempre na linha gravada", async () => {
    await send({ text: "Olá" });

    const id = messageRow(7).id;
    const updates = chainsWith("update");
    const stamped =
      updates.find((chain) =>
        chain.some(([name, values]) => name === "update" && (values as { external_id?: string }).external_id === "provider-1")
      ) ?? [];
    const marked = updates.find((chain) => has(chain, "update", { delivery_status: "sent" })) ?? [];

    expect(updates).toHaveLength(2);
    expect(has(stamped, "update", { external_id: "provider-1", metadata: { clientId: clientIdOf(KEY), uazapiId: "uazapi-1" } })).toBe(true);
    expect(where(stamped, "id", id)).toBe(true);
    expect(where(marked, "id", id)).toBe(true);
    // Monótono: um delivered/read que chegou durante o envio não regride.
    expect(has(marked, "in", "delivery_status", ["pending"])).toBe(true);
    // A resposta é a releitura DESTA linha.
    const reread = (h.chains.chat_messages ?? []).at(-1) ?? [];
    expect(reread.map(([name]) => name)).toEqual(["select", "eq", "single"]);
    expect(where(reread, "id", id)).toBe(true);
  });

  it("sem canal: o 409 diz o que falta", async () => {
    credentialsMock.mockResolvedValue(null);

    expect((await json(await send({ text: "Olá" }))).error).toMatchObject({
      code: "channel_unavailable",
      message: "A conversa não tem um canal de WhatsApp ativo para envio.",
    });
  });

  it("a mensagem nasce com a hora do servidor", async () => {
    const before = Date.now();
    await send({ text: "Olá" });

    const createdAt = Date.parse(String(insertPayload()?.created_at));
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("linha gravada fora do vocabulário é 500, nunca 201 com dado vazio", async () => {
    h.tables.chat_messages = messagesDb({ final: sentRow({ sender_type: "robô" }) });
    const log = silence();

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("internal_error");
    expect(logged(log, payload)).toBe(true);
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("corpo vazio é 400 invalid_json, sem ler a conversa", async () => {
    const response = await call(postMessage, { method: "POST", rawBody: "", headers: { "idempotency-key": KEY }, params: { id: conv } });

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_json");
    expect(h.chains.chat_conversations).toBeUndefined();
  });

  it("leitura da conversa que falhou: o log leva o request_id", async () => {
    h.tables.chat_conversations = dbError;
    const log = silence();

    const payload = await json(await send({ text: "Olá" }));

    expect(logged(log, payload)).toBe(true);
  });

  it("credencial que não pôde ser lida não vira 'sem canal' nem erro interno: 503, sem gravar nem mandar, e a chave é liberada", async () => {
    const failure = new Error("vault: segredo do banco");
    credentialsMock.mockRejectedValue(failure);
    const log = silence();

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(payload.error).toMatchObject({ code: "unavailable", message: "Não foi possível ler a integração do WhatsApp agora. Tente de novo." });
    noSecrets(payload);
    // Uma linha de log, com o request_id e o erro do banco.
    expect(log).toHaveBeenCalledTimes(1);
    expect(logged(log, payload)).toBe(true);
    expect(log.mock.calls[0]).toContain(failure);
    expect(h.chains.chat_messages).toBeUndefined();
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(rpcNames()).toContain("api_idempotency_release");
    expect(rpcNames()).not.toContain("api_idempotency_finish");
  });

  it("releitura que falha depois do envio ainda é 201, com a linha como foi gravada (pending)", async () => {
    const base = messagesDb();
    h.tables.chat_messages = (calls) =>
      calls.some(([method]) => method === "single") && !calls.some(([method]) => method === "insert")
        ? { data: null, error: { message: "segredo do banco" } }
        : base(calls);

    const response = await send({ text: "Olá" });
    const payload = await json(response);

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ id: messageRow(7).id, delivery_status: "pending" });
    expect(sendTextMock).toHaveBeenCalledTimes(1);
  });

  it("texto com link: a prévia entra no metadata da linha, e a do provedor prevalece depois do envio", async () => {
    const provider = { url: "https://ajuda.exemplo.com/boleto", siteName: "ajuda.exemplo.com", title: "Segunda via" };
    sendTextMock.mockResolvedValue({ id: "uazapi-1", messageid: "provider-1", linkPreview: provider });

    await send({ text: "Veja https://ajuda.exemplo.com/boleto" });

    expect(insertPayload()?.metadata).toEqual({
      clientId: clientIdOf(KEY),
      linkPreview: { url: "https://ajuda.exemplo.com/boleto", siteName: "ajuda.exemplo.com" },
    });
    const stamped = chainsWith("update")[0]?.find(([name]) => name === "update")?.[1] as { metadata?: unknown } | undefined;
    expect(stamped?.metadata).toEqual({ clientId: clientIdOf(KEY), uazapiId: "uazapi-1", linkPreview: provider });
  });

  it("o reenvio de uma falha vira a linha DELA para pending (e só ela)", async () => {
    h.tables.chat_messages = messagesDb({
      existing: sentRow({ delivery_status: "failed", external_id: null }),
      updated: sentRow({ delivery_status: "pending", external_id: null }),
    });

    expect((await send({ text: "Olá, sou a assistente." })).status).toBe(201);

    const flip = chainsWith("update")[0] ?? [];
    expect(has(flip, "update", { delivery_status: "pending" })).toBe(true);
    expect(where(flip, "id", messageRow(7).id)).toBe(true);
  });

  it("o teto da hora também é por token E por conversa", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
      for (let n = 1; n <= MESSAGES_PER_CONVERSATION_PER_HOUR; n += 1) {
        if (n > 1 && (n - 1) % MESSAGES_PER_CONVERSATION_PER_MIN === 0) vi.advanceTimersByTime(61_000);
        expect((await send({ text: `mensagem ${n}` }, conv, { "idempotency-key": `balde-${String(n).padStart(4, "0")}` })).status).toBe(201);
      }
      vi.advanceTimersByTime(61_000);
      expect((await send({ text: "a mais" }, conv, { "idempotency-key": "balde-9999" })).status).toBe(429);

      // Outra conversa, mesmo token: segue.
      const other = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e";
      h.tables.chat_conversations = () => ({ data: conversationRow({ id: other }), error: null });
      expect((await send({ text: "em outra conversa" }, other, { "idempotency-key": "balde-outra" })).status).toBe(201);

      // Mesma conversa, outro token: segue.
      h.tables.chat_conversations = () => ({ data: conversationRow({ id: conv }), error: null });
      const tokenRow = h.tables.api_tokens;
      h.tables.api_tokens = (calls) => {
        const result = tokenRow(calls);
        return { ...result, data: { ...(result.data as Record<string, unknown>), id: "tok-2" } };
      };
      h.tables.chat_messages = messagesDb({ final: sentRow({ sent_by_token_id: "tok-2" }) });
      expect((await send({ text: "de outro token" }, conv, { "idempotency-key": "balde-token2" })).status).toBe(201);
      h.tables.api_tokens = tokenRow;
    } finally {
      vi.useRealTimers();
    }
  });

  it("o POST /messages publica a mensagem no 201 e no 200, o corpo MessageSend obrigatório e os tetos do código", () => {
    const { post } = buildOpenApiDocument().paths["/conversations/{id}/messages"];
    const ref = (name: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${name}` } } });

    expect(post.responses["201"].content).toEqual(ref("ConversationMessage"));
    expect(post.responses["200"].content).toEqual(ref("ConversationMessage"));
    expect(post.requestBody).toEqual({ required: true, content: ref("MessageSend") });
    expect(post.summary).toContain(`${MESSAGES_PER_CONVERSATION_PER_MIN} envios por minuto e ${MESSAGES_PER_CONVERSATION_PER_HOUR} por hora`);
    // Só o que a rota devolve: um status a mais ou a menos aqui é contrato que mudou.
    expect(Object.keys(post.responses).sort()).toEqual(
      ["200", "201", "400", "401", "403", "404", "409", "413", "415", "422", "429", "502", "503", "504", "default"].sort()
    );
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
    expect(schemas.ConversationMessage).toEqual(z.toJSONSchema(itemOf(conversationMessageSchema)));
    expect(schemas.MessageSend).toEqual(z.toJSONSchema(messageSendBodySchema, { io: "input" }));
    expect(schemas.Handoff).toEqual(z.toJSONSchema(handoffBodySchema, { io: "input" }));
    expect(schemas.HandoffResult).toEqual(z.toJSONSchema(itemOf(handoffResultSchema)));
    expect(schemas.ActiveTicket).toEqual(z.toJSONSchema(activeTicketBodySchema, { io: "input" }));
    expect(schemas.ActiveTicketResult).toEqual(z.toJSONSchema(itemOf(activeTicketResultSchema)));
  });
});
