// @vitest-environment node
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signMock, secretMock, delayMock } = vi.hoisted(() => ({
  signMock: vi.fn(),
  secretMock: vi.fn(),
  delayMock: vi.fn(),
}));
vi.mock("@/lib/storage/chat-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/chat-media")>()),
  signStorageObject: signMock,
}));
// O cofre é de mentira; a classe do erro é a de verdade (o repasse a reconhece).
vi.mock("@/features/settings/lib/get-runtime-environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/settings/lib/get-runtime-environment")>()),
  readRuntimeEnvironmentVariable: secretMock,
}));
// A espera antes da 2ª tentativa não corre de verdade: fica só registrada.
vi.mock("node:timers/promises", () => ({ setTimeout: delayMock }));

import { createHarness, where, type Call } from "@/app/api/v1/test-harness";
import { relayFieldsSchema } from "@/features/integrations/server/relay-envelope";
import { relayInboundMessage, type RelayDelivery } from "@/features/integrations/server/relay-message";
import { RuntimeEnvironmentUnavailableError } from "@/features/settings/lib/get-runtime-environment";

// O repasse ao agente de ponta a ponta, sem rede: a URL e o contexto vêm do
// Supabase falso de test-harness.ts, o `fetch` é de mentira, e a assinatura é
// conferida por uma conta feita AQUI (node:crypto), não pela função do app.

const CONTACT_ID = "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const CONVERSATION_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const MESSAGE_ID = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const PAST = "2026-01-01T00:00:00+00:00";
const NOW = new Date("2026-10-01T12:00:00.700Z");
const NOW_SECONDS = "1790856000";
const RELAY_URL = "https://agente.exemplo.com/webhook/7f3c?fluxo=suporte";
const SECRET = "chave-de-assinatura-de-teste-com-32-ou-mais";
const INSTANCE_TOKEN = "3f1c9a7e-5b2d-4c8f-9e6a-0d4b7c2e1f58";
const TEXT = "O sistema voltou a travar";

const contactRow = {
  id: CONTACT_ID,
  name: "Maria",
  phone: "5527999990000",
  normalized_phone: "27999990000",
  email: null,
  notes: null,
  source: "whatsapp",
  customer_id: null,
  last_message_at: PAST,
  archived_at: null,
  created_at: PAST,
  updated_at: PAST,
};

const FUTURE = "2099-01-01T00:00:00+00:00";
const ticketRow = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  number: 101,
  title: "Nota não sai",
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
  first_responded_at: null,
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  next_due_at: FUTURE,
  last_inbound_at: PAST,
  replied_after_resolve: false,
  created_at: PAST,
  updated_at: PAST,
  customer: null,
  contact: { id: CONTACT_ID, name: "Maria", phone: "5527999990000" },
  product: null,
  assignee: null,
  ...overrides,
});

const payload = {
  BaseUrl: "https://inst.uazapi.test",
  EventType: "messages",
  instanceName: "suporte",
  owner: "5511900000000",
  token: INSTANCE_TOKEN,
  message: {
    messageid: "WA-IN-1",
    chatid: "5527999990000@s.whatsapp.net",
    fromMe: false,
    messageType: "Conversation",
    text: TEXT,
  },
};
const withoutToken = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "token"));

const delivery = (overrides: Partial<RelayDelivery> = {}): RelayDelivery => ({
  payload,
  conversationId: CONVERSATION_ID,
  contactId: CONTACT_ID,
  messageId: MESSAGE_ID,
  media: null,
  instanceToken: INSTANCE_TOKEN,
  ...overrides,
});

const adminClientMock = vi.fn();
const h = createHarness(adminClientMock);
let supabase: Parameters<typeof relayInboundMessage>[0];
let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

/** O `fetch` de mentira: `elapsedMs` é quanto o agente "demora". */
function agent(respond: () => unknown, elapsedMs = 0) {
  fetchMock.mockImplementation(async () => {
    vi.advanceTimersByTime(elapsedMs);
    return respond();
  });
}

const relay = (overrides?: Partial<RelayDelivery>) => relayInboundMessage(supabase, delivery(overrides));
const sentInit = (call = 0) => fetchMock.mock.calls[call][1] as RequestInit & { headers: Record<string, string> };
const sentBody = (call = 0) => String(sentInit(call).body);

/** As linhas gravadas em integration_logs. */
const logged = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);

/**
 * A linha de erro INTEIRA. Comparada por igualdade, para que nada entre de
 * carona no registro de uma falha (o payload, o texto do cliente) nem saia dele
 * (o id do evento).
 */
const errorRow = (error: string, extra: { http_status?: number; latency_ms?: number } = {}) => ({
  provider: "relay",
  direction: "outbound",
  action: "conversation.message_received",
  status: "error",
  payload: undefined,
  error,
  api_token_id: null,
  request_id: MESSAGE_ID,
  route: undefined,
  http_status: extra.http_status,
  latency_ms: extra.latency_ms,
});

/** Responde com falha nas `failures` primeiras leituras da tabela, e depois com o normal. */
function failingFirst(table: string, failures: number) {
  const normal = h.tables[table];
  let reads = 0;
  h.tables[table] = (calls) => {
    reads += 1;
    return reads <= failures ? { data: null, error: { message: "timeout" } } : normal(calls);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Só os relógios (o do instante e o de duração): as promessas seguem de verdade.
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  h.reset([]);
  Object.assign(h.tables, {
    app_settings: () => ({ data: { value: { relay_url: RELAY_URL } }, error: null }),
    contacts: () => ({ data: contactRow, error: null }),
    chat_conversations: () => ({ data: { status: "bot", active_ticket_id: null }, error: null }),
  } satisfies typeof h.tables);
  supabase = adminClientMock();
  secretMock.mockResolvedValue(SECRET);
  delayMock.mockResolvedValue(undefined);
  fetchMock = vi.fn();
  agent(() => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  warn.mockRestore();
  error.mockRestore();
});

describe("relayInboundMessage: o que sai", () => {
  it("POST na URL configurada, uma vez, sem seguir redirecionamento", async () => {
    await relay();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // O destino é o objeto que PASSOU pela guarda, não o texto lido do banco.
    expect(fetchMock.mock.calls[0][0]).toBeInstanceOf(URL);
    expect(String(fetchMock.mock.calls[0][0])).toBe(RELAY_URL);
    expect(sentInit()).toMatchObject({ method: "POST", redirect: "manual" });
    expect(where(h.chains.app_settings[0], "key", "automation")).toBe(true);
    expect(delayMock).not.toHaveBeenCalled();
  });

  it("o corpo é o envelope da uazapi sem o token, com os campos do CRM do contrato", async () => {
    await relay();

    const body = JSON.parse(sentBody());
    expect(body).toMatchObject(withoutToken);
    expect(body).not.toHaveProperty("token");
    expect(sentBody()).not.toContain(INSTANCE_TOKEN);

    const crmKeys = Object.keys(relayFieldsSchema.shape);
    const crm = Object.fromEntries(crmKeys.map((key) => [key, body[key]]));
    expect(relayFieldsSchema.safeParse(crm).error?.issues ?? []).toEqual([]);
    expect(crm).toEqual({
      relay_version: 1,
      conversation_id: CONVERSATION_ID,
      conversation_status: "bot",
      message_id: MESSAGE_ID,
      contact: contactRow,
      customer: null,
      contract: { status: null, alert: "sem_empresa" },
      active_ticket: null,
      media_url: null,
    });
    // A raiz é a da uazapi (sem o token) mais os campos do CRM, e só.
    expect(Object.keys(body)).toEqual([...Object.keys(withoutToken), ...crmKeys]);
  });

  it("o status que vai é o que a conversa tem na hora do envelope, mesmo que não seja mais `bot`", async () => {
    h.tables.chat_conversations = () => ({ data: { status: "human", active_ticket_id: null }, error: null });

    await relay();

    expect(JSON.parse(sentBody()).conversation_status).toBe("human");
  });

  it("status que o app não conhece: nada é enviado (nunca um `bot` suposto), e fica no registro", async () => {
    h.tables.chat_conversations = () => ({ data: { status: "pausada", active_ticket_id: null }, error: null });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow("Não foi possível montar o envelope.")]);
  });

  it("a mídia da mensagem chega ao agente: media_url é a URL assinada do arquivo dela", async () => {
    signMock.mockResolvedValue("https://crm.exemplo.com/storage/v1/object/sign/chat-media/chat/a.jpg?token=x");

    await relay({ media: { bucket: "chat-media", key: "chat/a.jpg" } });

    expect(JSON.parse(sentBody()).media_url).toBe(
      "https://crm.exemplo.com/storage/v1/object/sign/chat-media/chat/a.jpg?token=x"
    );
    expect(signMock).toHaveBeenCalledWith(supabase, "chat-media", "chat/a.jpg", 600);
  });

  it("o SLA do ticket em foco é o de AGORA, não o de uma data fixa", async () => {
    // A 1ª resposta venceu 1 s antes do instante do repasse.
    const due = new Date(NOW.getTime() - 1_000).toISOString();
    h.tables.chat_conversations = () => ({ data: { status: "bot", active_ticket_id: "t1" }, error: null });
    h.tables.ticket_queue = () => ({ data: ticketRow({ first_response_due_at: due, next_due_at: due }), error: null });

    await relay();

    const ticket = JSON.parse(sentBody()).active_ticket;
    expect(ticket).toMatchObject({ id: "t1", number: 101, version: 3 });
    expect(ticket.sla.breached).toBe(true);
  });

  it("os cabeçalhos dizem quem envia, o evento, o id estável dele e o instante, em segundos", async () => {
    await relay();

    expect(sentInit().headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "crm-suporte-relay/1",
      "X-CRM-Event": "conversation.message_received",
      "X-CRM-Event-Id": MESSAGE_ID,
      "X-CRM-Timestamp": NOW_SECONDS,
      "X-CRM-Signature": expect.stringMatching(/^v1=[0-9a-f]{64}$/),
    });
  });

  it("a assinatura confere com a chave do cofre sobre `<timestamp>.<corpo exato>`", async () => {
    await relay();

    const { headers } = sentInit();
    const expected = createHmac("sha256", SECRET)
      .update(`${headers["X-CRM-Timestamp"]}.${sentBody()}`, "utf8")
      .digest("hex");
    expect(headers["X-CRM-Signature"]).toBe(`v1=${expected}`);
    expect(secretMock).toHaveBeenCalledWith("RELAY_SIGNING_SECRET");
  });

  it("o instante assinado é o MESMO do cabeçalho, ainda que o relógio vire entre uma leitura e outra", async () => {
    // Cada leitura do relógio anda 1 s: assinar com um instante relido daria outra conta.
    let reads = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => NOW.getTime() + 1_000 * reads++);

    await relay();
    clock.mockRestore();

    const { headers } = sentInit();
    const expected = createHmac("sha256", SECRET)
      .update(`${headers["X-CRM-Timestamp"]}.${sentBody()}`, "utf8")
      .digest("hex");
    expect(headers["X-CRM-Signature"]).toBe(`v1=${expected}`);
  });

  it("a chave é lida do cofre a cada repasse: trocar vale já no próximo", async () => {
    await relay();
    secretMock.mockResolvedValue("outra-chave-de-assinatura-com-32-ou-mais");
    await relay();

    expect(secretMock).toHaveBeenCalledTimes(2);
    const { headers } = sentInit(1);
    const expected = createHmac("sha256", "outra-chave-de-assinatura-com-32-ou-mais")
      .update(`${headers["X-CRM-Timestamp"]}.${sentBody(1)}`, "utf8")
      .digest("hex");
    expect(headers["X-CRM-Signature"]).toBe(`v1=${expected}`);
    expect(headers["X-CRM-Signature"]).not.toBe(sentInit(0).headers["X-CRM-Signature"]);
  });

  it("sem chave no cofre: sai sem assinatura, com os outros cabeçalhos", async () => {
    secretMock.mockResolvedValue(null);

    await relay();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentInit().headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "crm-suporte-relay/1",
      "X-CRM-Event": "conversation.message_received",
      "X-CRM-Event-Id": MESSAGE_ID,
      "X-CRM-Timestamp": NOW_SECONDS,
    });
    expect(logged()).toEqual([expect.objectContaining({ status: "ok" })]);
  });

  it("tem prazo de 10 s: um agente que não responde não fica pendurado", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await relay();

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(sentInit().signal).toBe(timeout.mock.results[0].value);
    // O prazo é do AGENTE: só começa a contar depois das leituras do CRM.
    expect(timeout.mock.invocationCallOrder[0]).toBeGreaterThan(secretMock.mock.invocationCallOrder[0]);
    timeout.mockRestore();
  });

  it("descarta o corpo da resposta: só o status interessa", async () => {
    const response = new Response("qualquer coisa", { status: 200 });
    const cancel = vi.spyOn(response.body!, "cancel");
    agent(() => response);

    await relay();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(logged()).toEqual([expect.objectContaining({ status: "ok" })]);
  });
});

// A credencial da instância NÃO sai do CRM: isso agora é garantido ao ENFILEIRAR
// (enqueueRelay tira o token e faz o leak-scan fail-closed). Os casos estão em
// relay-dispatch.test.ts > "a credencial da instância não é enfileirada". Aqui,
// o payload que chega já está limpo (o outbox nunca guardou o token).

describe("relayInboundMessage: o registro em integration_logs", () => {
  it("entrega: status ok, o HTTP do agente e a latência do envio", async () => {
    agent(() => new Response(null, { status: 204 }), 137);

    await relay();

    expect(logged()).toEqual([
      {
        provider: "relay",
        direction: "outbound",
        action: "conversation.message_received",
        status: "ok",
        payload: undefined,
        error: undefined,
        api_token_id: null,
        request_id: MESSAGE_ID,
        route: undefined,
        http_status: 204,
        latency_ms: 137,
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a latência é só a do envio: o tempo das leituras antes dele não conta", async () => {
    const contacts = h.tables.contacts;
    h.tables.contacts = (calls) => {
      vi.advanceTimersByTime(5_000);
      return contacts(calls);
    };
    agent(() => new Response(null, { status: 200 }), 40);

    await relay();

    expect(logged()).toEqual([expect.objectContaining({ latency_ms: 40 })]);
  });

  it("o registro não leva o corpo, o texto do cliente nem a URL do agente", async () => {
    agent(() => new Response(null, { status: 500 }));

    await relay();

    const row = JSON.stringify(logged());
    expect(row).not.toContain(TEXT);
    expect(row).not.toContain("agente.exemplo.com");
    expect(row).not.toContain("7f3c");
    expect(row).not.toContain(SECRET);
    const consoleOutput = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(consoleOutput).not.toContain("7f3c");
    expect(consoleOutput).not.toContain(TEXT);
    expect(consoleOutput).not.toContain(SECRET);
  });

  it.each([500, 404, 401])("agente que responde %i: erro, com o HTTP e a latência, sem nova tentativa", async (status) => {
    agent(() => new Response("erro", { status }), 42);

    await relay();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delayMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow(`O agente respondeu HTTP ${status}.`, { http_status: status, latency_ms: 42 })]);
    expect(warn).toHaveBeenCalledWith("[relay] sem confirmação de entrega:", {
      eventId: MESSAGE_ID,
      error: `O agente respondeu HTTP ${status}.`,
    });
  });

  it("redirecionamento não é seguido, e fica como erro", async () => {
    agent(() => new Response(null, { status: 307, headers: { Location: "http://10.0.0.5/interno" } }));

    await relay();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logged()).toEqual([errorRow("O agente respondeu HTTP 307.", { http_status: 307, latency_ms: 0 })]);
  });

  it.each([
    [99, undefined],
    [100, 100],
    [599, 599],
    [600, undefined],
    [999, undefined],
  ])("status %i: fora da faixa que o banco aceita, o registro sai sem o HTTP (mas sai)", async (status, stored) => {
    // O Response do padrão não aceita esses números; o agente, sim.
    agent(() => ({ ok: false, status, body: null }));

    await relay();

    expect(logged()).toEqual([errorRow(`O agente respondeu HTTP ${status}.`, { http_status: stored, latency_ms: 0 })]);
  });

  it("agente que não responde no prazo: erro de tempo, sem HTTP, com a latência, sem nova tentativa", async () => {
    fetchMock.mockImplementation(async () => {
      vi.advanceTimersByTime(10_000);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    await relay();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delayMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow("O agente não respondeu em 10 s.", { latency_ms: 10_000 })]);
  });

  it.each([
    ["com código", new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }), "Falha de rede (ECONNREFUSED)."],
    ["sem código", new TypeError("fetch failed"), "Falha de rede."],
    ["com código que não é texto", new TypeError("fetch failed", { cause: { code: 42 } }), "Falha de rede."],
    ["que nem é Error", "caiu", "Falha de rede."],
    ["que é null", null, "Falha de rede."],
  ])("falha de rede %s: fica no registro, e o envio não se repete", async (_label, failure, expected) => {
    fetchMock.mockRejectedValue(failure);

    await relay();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delayMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow(expected, { latency_ms: 0 })]);
  });
});

describe("relayInboundMessage: quando o repasse não sai", () => {
  it("sem agente configurado: não lê o contexto, não envia e não registra", async () => {
    h.tables.app_settings = () => ({ data: null, error: null });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.chains.contacts).toBeUndefined();
    expect(secretMock).not.toHaveBeenCalled();
    expect(delayMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
    // Repasse desligado é o estado normal de quem não tem agente: nada no console.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ["URL vazia", { relay_url: "" }],
    ["só espaços", { relay_url: "   " }],
    ["sem a chave", {}],
    ["valor que não é texto", { relay_url: 42 }],
    ["valor que não é objeto", ["https://agente.exemplo.com"]],
  ])("configuração sem URL (%s) é `sem agente`", async (_label, value) => {
    h.tables.app_settings = () => ({ data: { value }, error: null });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });

  it("URL com espaço em volta é usada sem ele", async () => {
    h.tables.app_settings = () => ({ data: { value: { relay_url: `  ${RELAY_URL}  ` } }, error: null });

    await relay();

    expect(String(fetchMock.mock.calls[0][0])).toBe(RELAY_URL);
  });

  it.each([
    ["rede interna", "https://169.254.169.254/latest", "A URL aponta para um host de rede interna (bloqueado)."],
    ["esquema que não é http", "ftp://agente.exemplo.com/x", "A URL deve usar http ou https."],
    ["texto que não é URL", "agente", "URL inválida."],
    ["credencial embutida", "https://usuario:senha@agente.exemplo.com/x", "A URL não pode levar usuário e senha."],
    ["só o usuário", "https://usuario@agente.exemplo.com/x", "A URL não pode levar usuário e senha."],
  ])("URL recusada (%s): não envia, não lê o contexto, não tenta de novo, e o motivo fica no registro", async (_label, url, reason) => {
    h.tables.app_settings = () => ({ data: { value: { relay_url: url } }, error: null });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.chains.contacts).toBeUndefined();
    // Com a URL recusada o cofre nem é lido: o motivo que o admin pode consertar não fica atrás de outro.
    expect(secretMock).not.toHaveBeenCalled();
    expect(delayMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow(`URL do agente recusada: ${reason}`)]);
  });

  it("rede interna é recusada também em produção, com HTTPS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    h.tables.app_settings = () => ({ data: { value: { relay_url: "https://10.0.0.5/hook" } }, error: null });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([
      errorRow("URL do agente recusada: A URL aponta para um host de rede interna (bloqueado)."),
    ]);
  });

  it("em produção, http é recusado; https passa", async () => {
    vi.stubEnv("NODE_ENV", "production");
    h.tables.app_settings = () => ({ data: { value: { relay_url: "http://agente.exemplo.com/x" } }, error: null });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow("URL do agente recusada: Em produção a URL deve usar HTTPS.")]);

    h.tables.app_settings = () => ({ data: { value: { relay_url: RELAY_URL } }, error: null });
    await relay();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("relayInboundMessage: leitura que falha antes do envio", () => {
  it("URL que não pôde ser lida nas duas tentativas: não é `sem agente`, fica registrado", async () => {
    h.tables.app_settings = () => ({ data: null, error: { message: "timeout" } });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.chains.contacts).toBeUndefined();
    expect(h.chains.app_settings).toHaveLength(2);
    expect(delayMock).toHaveBeenCalledTimes(1);
    expect(delayMock).toHaveBeenCalledWith(1_000);
    expect(logged()).toEqual([errorRow("Não foi possível ler a URL do agente.")]);
  });

  it.each([
    ["a URL", "app_settings"],
    ["o contato", "contacts"],
    ["a conversa", "chat_conversations"],
  ])("falha passageira ao ler %s: espera 1 s, tenta de novo e entrega, com UM registro", async (_label, table) => {
    failingFirst(table, 1);

    await relay();

    expect(delayMock).toHaveBeenCalledTimes(1);
    expect(delayMock).toHaveBeenCalledWith(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logged()).toEqual([expect.objectContaining({ status: "ok", http_status: 200 })]);
  });

  it("cofre que falha uma vez: tenta de novo e sai assinado", async () => {
    secretMock.mockRejectedValueOnce(new RuntimeEnvironmentUnavailableError("timeout"));

    await relay();

    expect(delayMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentInit().headers["X-CRM-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(logged()).toEqual([expect.objectContaining({ status: "ok" })]);
  });

  it("contexto que não pôde ser lido nas duas tentativas: tudo ou nada, o repasse não sai", async () => {
    h.tables.contacts = () => ({ data: null, error: { message: "timeout" } });

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(delayMock).toHaveBeenCalledTimes(1);
    expect(h.chains.contacts).toHaveLength(2);
    expect(logged()).toEqual([errorRow("Não foi possível montar o envelope.")]);
    expect(error).toHaveBeenCalledWith("[relay] montar o envelope falhou:", expect.any(Error));
  });

  it("cofre ilegível nas duas tentativas não é `sem chave`: o repasse não sai sem assinatura", async () => {
    secretMock.mockRejectedValue(new RuntimeEnvironmentUnavailableError("timeout"));

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(secretMock).toHaveBeenCalledTimes(2);
    expect(logged()).toEqual([errorRow("Cofre indisponível: não foi possível ler a chave de assinatura.")]);
    expect(error).toHaveBeenCalledWith(
      "[relay] ler a chave de assinatura falhou:",
      expect.any(RuntimeEnvironmentUnavailableError)
    );
  });

  it("qualquer falha ao ler a chave conta como cofre indisponível, não só a do tipo esperado", async () => {
    secretMock.mockRejectedValue(new TypeError("fetch failed"));

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow("Cofre indisponível: não foi possível ler a chave de assinatura.")]);
  });

  it("contexto e cofre falhando juntos: o motivo registrado é sempre o do envelope", async () => {
    h.tables.contacts = () => ({ data: null, error: { message: "timeout" } });
    secretMock.mockRejectedValue(new RuntimeEnvironmentUnavailableError("timeout"));

    await relay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([errorRow("Não foi possível montar o envelope.")]);
  });

  it("no máximo duas tentativas: a 3ª leitura não acontece", async () => {
    failingFirst("contacts", 5);

    await relay();

    expect(h.chains.contacts).toHaveLength(2);
    expect(delayMock).toHaveBeenCalledTimes(1);
    expect(logged()).toHaveLength(1);
  });

  it("agente desconfigurado durante a espera: a 2ª tentativa não envia nem registra", async () => {
    let reads = 0;
    h.tables.app_settings = () => {
      reads += 1;
      return reads === 1 ? { data: null, error: { message: "timeout" } } : { data: null, error: null };
    };

    await relay();

    expect(delayMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });
});

describe("relayInboundMessage: só termina com o registro gravado", () => {
  it("a promessa fica pendente enquanto o registro não é gravado (o Next a espera antes de sair num deploy)", async () => {
    let finishInsert: ((value: { data: null; error: null }) => void) | undefined;
    h.tables.integration_logs = () =>
      new Promise((resolve) => {
        finishInsert = resolve;
      }) as never;
    let settled = false;

    const done = relay().then(() => {
      settled = true;
    });
    // Deixa o repasse andar até a gravação do registro começar.
    for (let turn = 0; turn < 50 && !finishInsert; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(finishInsert).toBeDefined();
    expect(settled).toBe(false);

    finishInsert?.({ data: null, error: null });
    await done;

    expect(settled).toBe(true);
  });
});

describe("relayInboundMessage: nunca rejeita (quem chama não espera)", () => {
  it("registro que o banco recusa: resolve mesmo assim", async () => {
    h.tables.integration_logs = () => ({ data: null, error: { message: "permission denied" } });

    // O log falhou em silêncio, mas a entrega valeu: devolve o desfecho de sucesso.
    await expect(relay()).resolves.toMatchObject({ error: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("registro que lança: resolve, e a falha vai para o console", async () => {
    const failure = new Error("rede do banco caiu");
    h.tables.integration_logs = () => {
      throw failure;
    };

    // Falha inesperada é engolida: devolve null (nada a settlar como entrega).
    await expect(relay()).resolves.toBeNull();

    expect(error).toHaveBeenCalledWith("[relay] falha inesperada:", failure);
  });

  it("resposta cujo corpo não cancela: a entrega continua valendo", async () => {
    const response = new Response("x", { status: 200 });
    vi.spyOn(response.body!, "cancel").mockRejectedValue(new Error("stream travado"));
    agent(() => response);

    await expect(relay()).resolves.toMatchObject({ error: null });

    expect(logged()).toEqual([expect.objectContaining({ status: "ok", http_status: 200 })]);
  });
});
