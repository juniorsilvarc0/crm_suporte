import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, adminClientMock, sendTextMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminClientMock: vi.fn(),
  sendTextMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/senders/uazapi", () => ({
  sendUazapiText: sendTextMock,
}));

import { POST } from "@/app/api/chat/conversations/[id]/send/route";

const params = { params: Promise.resolve({ id: "conversation-1" }) };

type Result = { data?: unknown; error?: unknown };

const calls: { table: string; method: string; payload?: unknown }[] = [];
const queues = new Map<string, Result[]>();

/**
 * Query encadeável de mentira: qualquer método devolve ela mesma, e o resultado
 * sai tanto no `await` direto (`update().eq().in()`) quanto em
 * `single()`/`maybeSingle()`. Cada chamada fica registrada em `calls` — é assim
 * que se afirma que o reenvio NÃO inseriu linha nova.
 */
function builder(table: string, result: Result) {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "eq", "in", "limit"]) {
    self[method] = (payload?: unknown) => {
      calls.push({ table, method, payload });
      return self;
    };
  }
  self.single = async () => result;
  self.maybeSingle = async () => result;
  self.then = (onOk: (value: Result) => unknown, onErr?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onOk, onErr);
  return self;
}

function queue(table: string, ...results: Result[]) {
  queues.set(table, [...(queues.get(table) ?? []), ...results]);
}

function request(body: unknown) {
  return new Request("http://x/api/chat/conversations/conversation-1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** As duas leituras que abrem qualquer envio: a conversa e a integração. */
function queueConversation() {
  queue("chat_conversations", {
    data: {
      id: "conversation-1",
      external_id: "5511999999999",
      contact_phone: "5511999999999",
      integration_id: "integration-1",
    },
    error: null,
  });
  queue("chat_integrations", {
    data: {
      provider: "uazapi",
      config: { apiUrl: "https://api.uazapi.test", token: "token" },
    },
    error: null,
  });
}

/** Nasceu linha nova em `chat_messages`? */
const insertedMessage = () =>
  calls.some((call) => call.table === "chat_messages" && call.method === "insert");

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  queues.clear();
  sessionMock.mockResolvedValue({
    viewer: {
      id: "user-1",
      name: "Ana Souza",
      apelido_atendimento: null,
      assinar_mensagens: true,
    },
  });
  adminClientMock.mockReturnValue({
    from: (table: string) => {
      const next = queues.get(table)?.shift();
      if (!next) throw new Error(`sem resultado enfileirado para ${table}`);
      return builder(table, next);
    },
  });
  sendTextMock.mockResolvedValue({ id: "uazapi-1", messageid: "provider-1" });
});

describe("POST /send — sessão", () => {
  it("recusa usuário desativado antes de tocar no banco ou no WhatsApp", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await POST(request({ content: "oi" }), params);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("grava a nota interna como do analista que escreveu", async () => {
    queue("chat_conversations", {
      data: { id: "conversation-1", external_id: "5511999999999" },
      error: null,
    });
    queue("chat_messages", { data: { id: "note-1" }, error: null });

    const response = await POST(request({ content: "ligar amanhã", kind: "note" }), params);

    expect(response.status).toBe(200);
    expect(calls.find((call) => call.method === "insert")?.payload).toMatchObject({
      type: "note",
      sender_type: "agent",
      sent_by_user_id: "user-1",
    });
  });
});

describe("POST /send — idempotência por clientId", () => {
  it("recusa clientId fora do charset antes de tocar no banco", async () => {
    const response = await POST(
      request({ content: "oi", clientId: "abc,def)" }),
      params
    );

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("grava o clientId no metadata no primeiro envio", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: null, error: null }, // não existe linha com esse clientId
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      { error: null }, // update external_id
      { error: null }, // update delivery_status
      { data: { id: "message-1", delivery_status: "sent" }, error: null }
    );

    const response = await POST(
      request({ content: "bom dia", clientId: "abc-123" }),
      params
    );

    expect(response.status).toBe(200);
    const insert = calls.find(
      (call) => call.table === "chat_messages" && call.method === "insert"
    );
    expect(insert?.payload).toMatchObject({
      metadata: { clientId: "abc-123" },
      delivery_status: "pending",
      sender_type: "agent",
      sent_by_user_id: "user-1",
      // A assinatura do operador é aplicada uma vez, aqui.
      content: "*Ana:*\nbom dia",
    });
    // O clientId sobrevive à sobrescrita do metadata pelo id do provedor.
    const withExternalId = calls.find(
      (call) =>
        call.table === "chat_messages" &&
        call.method === "update" &&
        (call.payload as { external_id?: string })?.external_id === "provider-1"
    );
    expect(withExternalId?.payload).toMatchObject({
      metadata: { clientId: "abc-123" },
    });
  });

  it("não manda de novo o que já saiu com o mesmo clientId", async () => {
    queueConversation();
    const already = {
      id: "message-1",
      delivery_status: "sent",
      content: "*Ana:*\nbom dia",
      metadata: { clientId: "abc-123" },
    };
    queue("chat_messages", { data: already, error: null });

    const response = await POST(
      request({ content: "bom dia", clientId: "abc-123" }),
      params
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: already });
    // O ponto todo: nada foi para o WhatsApp e nenhuma linha nova nasceu.
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(insertedMessage()).toBe(false);
  });

  it("reenvia a MESMA linha que falhou, sem assinar duas vezes", async () => {
    queueConversation();
    queue(
      "chat_messages",
      {
        data: {
          id: "message-1",
          delivery_status: "failed",
          content: "*Ana:*\nbom dia",
          quoted_message_id: null,
          metadata: { clientId: "abc-123" },
        },
        error: null,
      },
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // volta a pendente
      { error: null }, // update external_id
      { error: null }, // update delivery_status
      { data: { id: "message-1", delivery_status: "sent" }, error: null }
    );

    const response = await POST(
      request({ content: "bom dia", clientId: "abc-123" }),
      params
    );

    expect(response.status).toBe(200);
    // Reusa a linha: nada de segunda mensagem na conversa.
    expect(insertedMessage()).toBe(false);
    // Sai o texto JÁ gravado — assinar de novo poria "*Ana:*" duas vezes.
    expect(sendTextMock).toHaveBeenCalledWith(
      "https://api.uazapi.test",
      "token",
      "5511999999999",
      "*Ana:*\nbom dia",
      expect.objectContaining({ trackId: "message-1" })
    );
    // E volta para `pending`, senão o tick monótono nunca sairia de `failed`.
    expect(
      calls.some(
        (call) =>
          call.table === "chat_messages" &&
          call.method === "update" &&
          (call.payload as { delivery_status?: string })?.delivery_status === "pending"
      )
    ).toBe(true);
  });

  it("clique duplo simultâneo: o INSERT barrado devolve a linha da outra requisição", async () => {
    queueConversation();
    const winner = { id: "message-1", delivery_status: "pending", metadata: { clientId: "abc-123" } };
    queue(
      "chat_messages",
      { data: null, error: null }, // as duas passaram pelo SELECT
      { data: null, error: { code: "23505" } }, // o índice único barrou esta
      { data: winner, error: null } // relê a linha da outra
    );

    const response = await POST(request({ content: "bom dia", clientId: "abc-123" }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: winner });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("dois reenvios simultâneos: só quem virou a linha para pendente manda", async () => {
    queueConversation();
    const failed = {
      id: "message-1",
      delivery_status: "failed",
      content: "*Ana:*\nbom dia",
      quoted_message_id: null,
      metadata: { clientId: "abc-123" },
    };
    const pending = { ...failed, delivery_status: "pending" };
    queue(
      "chat_messages",
      { data: failed, error: null },
      { data: null, error: null }, // a outra requisição já tirou de `failed`
      { data: pending, error: null }
    );

    const response = await POST(request({ content: "bom dia", clientId: "abc-123" }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: pending });
    expect(sendTextMock).not.toHaveBeenCalled();
    // O UPDATE para `pending` só casa linha que ainda está `failed`.
    expect(
      calls.some(
        (call) =>
          call.table === "chat_messages" &&
          call.method === "eq" &&
          call.payload === "delivery_status"
      )
    ).toBe(true);
  });
});
