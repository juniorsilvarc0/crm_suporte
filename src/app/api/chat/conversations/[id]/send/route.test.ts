import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, adminClientMock, sendTextMock, credentialsMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminClientMock: vi.fn(),
  sendTextMock: vi.fn(),
  credentialsMock: vi.fn(),
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
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getIntegrationCredentials: credentialsMock,
}));

import { POST } from "@/app/api/chat/conversations/[id]/send/route";

const params = { params: Promise.resolve({ id: "conversation-1" }) };

type Result = { data?: unknown; error?: unknown };

const calls: { table: string; method: string; payload?: unknown; args?: unknown[] }[] = [];
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
    self[method] = (...args: unknown[]) => {
      calls.push({ table, method, payload: args[0], args });
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

/** A leitura que abre qualquer envio (a credencial vem do Vault, mockada). */
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
  credentialsMock.mockResolvedValue({
    id: "integration-1",
    apiUrl: "https://api.uazapi.test",
    token: "token",
    phone_number: null,
  });
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

  it("para a tela o clientId não é amarrado ao texto: com outro texto no corpo, devolve a linha que já saiu", async () => {
    queueConversation();
    const already = {
      id: "message-1",
      delivery_status: "sent",
      content: "*Ana:*\nbom dia",
      metadata: { clientId: "abc-123" },
    };
    queue("chat_messages", { data: already, error: null });

    const response = await POST(request({ content: "outro texto", clientId: "abc-123" }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: already });
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

  it("credencial que não pôde ser lida: 500, e o log leva o erro do banco (não um desfecho do helper)", async () => {
    queueConversation();
    const failure = new Error("vault fora do ar");
    credentialsMock.mockRejectedValue(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ content: "bom dia", clientId: "abc-123" }), params);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error" });
    expect(log).toHaveBeenCalledWith("[POST /api/chat/conversations/[id]/send]", failure);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(insertedMessage()).toBe(false);
    log.mockRestore();
  });

  it("sem token no Vault não envia nem grava mensagem", async () => {
    queueConversation();
    queue("chat_messages", { data: null, error: null });
    credentialsMock.mockResolvedValue(null);

    const response = await POST(request({ content: "bom dia", clientId: "abc-123" }), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No integration" });
    expect(credentialsMock).toHaveBeenCalledWith(expect.anything(), "integration-1");
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(insertedMessage()).toBe(false);
  });
});

// O envio passou a morar em send-outbound.ts (o mesmo caminho da API v1). Estes
// casos fixam o que a TELA recebe de cada desfecho dele.
describe("POST /send — desfechos do envio", () => {
  it("conversa sem endereço do canal é 400, sem buscar a credencial nem gravar", async () => {
    queue("chat_conversations", {
      data: { id: "conversation-1", external_id: " ", contact_phone: null, integration_id: "integration-1" },
      error: null,
    });

    const response = await POST(request({ content: "bom dia" }), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No phone on conversation" });
    expect(credentialsMock).not.toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(insertedMessage()).toBe(false);
  });

  it("falha do provedor é 502, e a linha vira failed (sem regredir um tick)", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      { error: null } // update para failed
    );
    sendTextMock.mockRejectedValue(new Error("uazapi fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ content: "bom dia" }), params);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Falha ao enviar pela API do WhatsApp." });
    const failed = calls.find(
      (call) =>
        call.table === "chat_messages" &&
        call.method === "update" &&
        (call.payload as { delivery_status?: string })?.delivery_status === "failed"
    );
    expect(failed).toBeDefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("responder: grava a citação e manda ao provedor o id DELE da mensagem citada", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: { id: "quoted-1", external_id: "provider-quoted" }, error: null }, // a citada
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      { error: null }, // update external_id
      { error: null }, // update delivery_status
      { data: { id: "message-1", delivery_status: "sent" }, error: null }
    );

    const response = await POST(request({ content: "sim", quotedMessageId: "quoted-1" }), params);

    expect(response.status).toBe(200);
    expect(calls.find((call) => call.table === "chat_messages" && call.method === "insert")?.payload).toMatchObject({
      quoted_message_id: "quoted-1",
    });
    expect(sendTextMock).toHaveBeenCalledWith(
      "https://api.uazapi.test",
      "token",
      "5511999999999",
      "*Ana:*\nsim",
      { trackId: "message-1", replyId: "provider-quoted" }
    );
  });

  it("para o analista até a demora do provedor vira failed: é ele quem decide se reenvia", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      { error: null } // update para failed
    );
    sendTextMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ content: "bom dia" }), params);

    expect(response.status).toBe(502);
    expect(
      calls.some(
        (call) =>
          call.table === "chat_messages" &&
          call.method === "update" &&
          (call.payload as { delivery_status?: string })?.delivery_status === "failed"
      )
    ).toBe(true);
    log.mockRestore();
  });

  it("para o analista, a gravação que lança depois do envio segue como sempre foi: failed e 502", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      // gravar o external_id LANÇA (não devolve erro)
      Object.defineProperty({}, "error", {
        get() {
          throw new Error("rede do banco caiu");
        },
      }),
      { error: null } // update para failed
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ content: "bom dia" }), params);

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
    expect(
      calls.some(
        (call) =>
          call.table === "chat_messages" &&
          call.method === "update" &&
          (call.payload as { delivery_status?: string })?.delivery_status === "failed"
      )
    ).toBe(true);
    log.mockRestore();
  });

  it("clique duplo em que a outra requisição já falhou: devolve a linha failed, para a tela oferecer o reenvio", async () => {
    queueConversation();
    const winner = { id: "message-1", delivery_status: "failed", metadata: { clientId: "abc-123" } };
    queue(
      "chat_messages",
      { data: null, error: null },
      { data: null, error: { code: "23505" } },
      { data: winner, error: null }
    );

    const response = await POST(request({ content: "bom dia", clientId: "abc-123" }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: winner });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it.each(["failed", "sent"])(
    "a tela não reenvia nem devolve a mensagem %s de um token: 409, sem gravar nem mandar",
    async (status) => {
      queueConversation();
      queue("chat_messages", {
        data: {
          id: "message-1",
          delivery_status: status,
          content: "Olá, sou a assistente.",
          quoted_message_id: null,
          sent_by_token_id: "token-1",
          sent_by_user_id: null,
          metadata: { clientId: "k0123456789abcdef0123456789abcdef01234567" },
        },
        error: null,
      });

      const response = await POST(
        request({ content: "Olá, sou a assistente.", clientId: "k0123456789abcdef0123456789abcdef01234567" }),
        params
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "Esta mensagem foi enviada por uma integração e só ela pode reenviá-la.",
      });
      expect(sendTextMock).not.toHaveBeenCalled();
      expect(calls.some((call) => call.table === "chat_messages" && ["insert", "update"].includes(call.method))).toBe(false);
    }
  );

  it("mensagem citada que não é desta conversa é 400, sem gravar nem mandar", async () => {
    queueConversation();
    queue("chat_messages", { data: null, error: null }); // a citada não existe aqui

    const response = await POST(request({ content: "sim", quotedMessageId: "de-outra-conversa" }), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "quoted message not found" });
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(insertedMessage()).toBe(false);
  });

  // ── o protocolo com o banco ─────────────────────────────────────────────────

  /** O que o envio fez em chat_messages, na ordem, com os argumentos. */
  const messageSteps = () =>
    calls.filter((call) => call.table === "chat_messages").map((call) => [call.method, ...(call.args ?? [])]);

  it("envio aceito: os UPDATEs miram a linha gravada e o sent só sobrescreve pending", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      { error: null }, // update external_id
      { error: null }, // update delivery_status
      { data: { id: "message-1", delivery_status: "sent" }, error: null }
    );

    const response = await POST(request({ content: "bom dia" }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: { id: "message-1", delivery_status: "sent" } });
    expect(messageSteps().slice(2)).toEqual([
      ["update", { external_id: "provider-1", metadata: { uazapiId: "uazapi-1" } }],
      ["eq", "id", "message-1"],
      ["update", { delivery_status: "sent" }],
      ["eq", "id", "message-1"],
      ["in", "delivery_status", ["pending"]],
      ["select"],
      ["eq", "id", "message-1"],
    ]);
  });

  it("falha do provedor: só esta linha vira failed, e só se ainda estava pending", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      { error: null } // update para failed
    );
    sendTextMock.mockRejectedValue(new Error("uazapi fora do ar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await POST(request({ content: "bom dia" }), params);

    expect(messageSteps().slice(2)).toEqual([
      ["update", { delivery_status: "failed" }],
      ["eq", "id", "message-1"],
      ["in", "delivery_status", ["pending"]],
    ]);
    log.mockRestore();
  });

  it("no reenvio valem o texto e a citação da LINHA, não os do corpo (a tela manda o texto já assinado)", async () => {
    queueConversation();
    queue(
      "chat_messages",
      {
        data: {
          id: "message-1",
          delivery_status: "failed",
          content: "*Ana:*\nbom dia",
          quoted_message_id: "quoted-1",
          metadata: { clientId: "abc-123" },
        },
        error: null,
      },
      { data: { id: "quoted-1", external_id: "provider-quoted" }, error: null }, // a citada da linha
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // volta a pendente
      { error: null }, // update external_id
      { error: null }, // update delivery_status
      { data: { id: "message-1", delivery_status: "sent" }, error: null }
    );

    // O "Tentar novamente" manda o conteúdo da bolha, que já está assinado (use-messages.ts).
    const response = await POST(request({ content: "*Ana:*\nbom dia", clientId: "abc-123" }), params);

    expect(response.status).toBe(200);
    expect(insertedMessage()).toBe(false);
    expect(sendTextMock).toHaveBeenCalledWith("https://api.uazapi.test", "token", "5511999999999", "*Ana:*\nbom dia", {
      trackId: "message-1",
      replyId: "provider-quoted",
    });
    // Só a linha que falhou volta a pending.
    const flip = messageSteps().findIndex(
      ([method, values]) => method === "update" && (values as { delivery_status?: string }).delivery_status === "pending"
    );
    expect(messageSteps().slice(flip, flip + 3)).toEqual([
      ["update", { delivery_status: "pending" }],
      ["eq", "id", "message-1"],
      ["eq", "delivery_status", "failed"],
    ]);
  });

  it("a citação é procurada só dentro da conversa", async () => {
    queueConversation();
    queue("chat_messages", { data: null, error: null });

    await POST(request({ content: "sim", quotedMessageId: "de-outra-conversa" }), params);

    expect(messageSteps().filter(([method]) => method === "eq")).toEqual([
      ["eq", "id", "de-outra-conversa"],
      ["eq", "conversation_id", "conversation-1"],
    ]);
  });

  it("a conversa é lida pelo id da rota", async () => {
    queueConversation();
    queue("chat_messages", { data: { id: "message-1", delivery_status: "pending" }, error: null }, { error: null }, { error: null }, {
      data: { id: "message-1", delivery_status: "sent" },
      error: null,
    });

    await POST(request({ content: "bom dia" }), params);

    expect(calls.filter((call) => call.table === "chat_conversations").map((call) => [call.method, ...(call.args ?? [])])).toEqual([
      ["select", "id, external_id, contact_phone, integration_id"],
      ["eq", "id", "conversation-1"],
    ]);
  });

  it("a mensagem nasce com a hora do servidor", async () => {
    queueConversation();
    queue("chat_messages", { data: { id: "message-1", delivery_status: "pending" }, error: null }, { error: null }, { error: null }, {
      data: { id: "message-1", delivery_status: "sent" },
      error: null,
    });
    const before = Date.now();

    await POST(request({ content: "bom dia" }), params);

    const inserted = calls.find((call) => call.table === "chat_messages" && call.method === "insert")?.payload as { created_at?: string };
    expect(Date.parse(String(inserted?.created_at))).toBeGreaterThanOrEqual(before);
    expect(Date.parse(String(inserted?.created_at))).toBeLessThanOrEqual(Date.now());
  });

  it("erro do banco ao gravar é 500 sem o detalhe, e nada vai ao WhatsApp", async () => {
    queueConversation();
    queue("chat_messages", { data: null, error: { code: "23514", message: "segredo do banco" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ content: "bom dia" }), params);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error" });
    expect(sendTextMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("releitura que falha depois do envio devolve a linha como foi gravada", async () => {
    queueConversation();
    queue(
      "chat_messages",
      { data: { id: "message-1", delivery_status: "pending" }, error: null }, // insert
      { error: null }, // update external_id
      { error: null }, // update delivery_status
      { data: null, error: { message: "timeout" } } // a releitura falhou
    );

    const response = await POST(request({ content: "bom dia" }), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: { id: "message-1", delivery_status: "pending" } });
    expect(sendTextMock).toHaveBeenCalledTimes(1);
  });
});
