// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  adminClientMock,
  integrationMock,
  secretMock,
  identityMock,
  relayMock,
  downloadMock,
  persistMediaMock,
  afterCallbacks,
} = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  integrationMock: vi.fn(),
  secretMock: vi.fn(),
  identityMock: vi.fn(),
  relayMock: vi.fn(),
  downloadMock: vi.fn(),
  persistMediaMock: vi.fn(),
  // O que o webhook agenda com after(): no Next, roda depois da resposta.
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getUazapiIntegration: integrationMock,
  getChatIntegrationSecret: secretMock,
}));
vi.mock("@/features/contacts/queries/resolve-contact-identity", () => ({
  resolveContactIdentity: identityMock,
}));
// O que sai no repasse (envelope, assinatura, log) é de relay-message.test.ts.
// Aqui fica QUANDO o webhook repassa, e com o quê.
vi.mock("@/features/integrations/server/relay-message", () => ({
  relayInboundMessage: relayMock,
}));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({
  downloadUazapiMedia: downloadMock,
}));
vi.mock("@/features/chat/lib/media/persist-inbound", () => ({
  persistInboundMedia: persistMediaMock,
}));

import { POST } from "@/app/api/chat/webhook/uazapi/route";

const SECRET = "a".repeat(64);
const INSTANCE_TOKEN = "token-da-instancia-de-teste";

function webhook(secret: string | null, body: unknown = { EventType: "presence" }) {
  const query = secret === null ? "" : `?s=${encodeURIComponent(secret)}`;
  return new Request(`http://x/api/chat/webhook/uazapi${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Roda o que ficou para depois da resposta, como o Next faz. */
async function runAfter() {
  await Promise.all(afterCallbacks.splice(0).map((callback) => callback()));
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  adminClientMock.mockReturnValue({});
  relayMock.mockResolvedValue(undefined);
  downloadMock.mockResolvedValue(null);
  persistMediaMock.mockResolvedValue(null);
  integrationMock.mockResolvedValue({
    id: "int-1",
    apiUrl: "https://inst.uazapi.test",
    token: INSTANCE_TOKEN,
    phone_number: null,
  });
  secretMock.mockResolvedValue(SECRET);
});

describe("POST /api/chat/webhook/uazapi — autenticação", () => {
  it("aceita o segredo da integração e segue para o processamento", async () => {
    const response = await POST(webhook(SECRET));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, reason: "skipped" });
    expect(secretMock).toHaveBeenCalledWith(expect.anything(), "int-1", "webhook_secret");
  });

  it.each([
    ["sem ?s=", null],
    ["?s= vazio", ""],
    ["?s= errado", "b".repeat(64)],
  ])("recusa %s com 401", async (_label, secret) => {
    const response = await POST(webhook(secret));

    expect(response.status).toBe(401);
  });

  it("recusa com 401 quando a integração não tem segredo no Vault", async () => {
    secretMock.mockResolvedValue(null);

    const response = await POST(webhook(""));

    expect(response.status).toBe(401);
  });

  it("sem integração responde o mesmo 401, sem revelar que não há instância", async () => {
    integrationMock.mockResolvedValue(null);

    const response = await POST(webhook(SECRET));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: "unauthorized" });
    expect(secretMock).not.toHaveBeenCalled();
  });

  it("não lê o corpo de quem não se autenticou", async () => {
    const request = webhook("errado");
    const json = vi.spyOn(request, "json");

    await POST(request);

    expect(json).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat/webhook/uazapi — relay ao agente", () => {
  const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  // Mensagem de texto recebida, no envelope real da uazapi (ids fictícios).
  const inbound = {
    EventType: "messages",
    message: {
      messageid: "WA-IN-1",
      chatid: "5511999998888@s.whatsapp.net",
      sender_pn: "5511999998888@s.whatsapp.net",
      senderName: "Cliente",
      fromMe: false,
      messageType: "conversation",
      text: "O sistema voltou a travar",
      messageTimestamp: 1_790_000_000,
    },
  };

  let conversationStatus: string;
  let conversationReads: number;
  // Os `.eq` de cada leitura da conversa: [0] é a 1ª leitura, [1] a releitura.
  let conversationFilters: unknown[][][];
  // Mensagens já gravadas, pelo `external_id`: o ON CONFLICT DO NOTHING.
  let storedExternalIds: Set<string | null>;
  // O `id` de cada linha inserida: é o que o banco devolve, e o que vai ao repasse.
  let insertedRowIds: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  // O banco nas partes que o upsertMessage toca. O INSERT da mensagem faz o
  // que o trigger increment_unread faz com o status (migration _tickets §10.1):
  // inbound em `resolved` volta para `bot`. Como no banco, um `external_id` já
  // gravado não insere nem devolve linha, e o trigger não roda. `rereadFails`
  // derruba a 2ª leitura da conversa (a releitura depois do INSERT). O fake
  // devolve a mesma linha qualquer que seja o filtro: quem confere o filtro é
  // o teste.
  function fakeDatabase({ rereadFails = false, insertFails = false } = {}) {
    const conversationRow = () => ({
      id: CONVERSATION_ID,
      contact_id: "contact-1",
      status: conversationStatus,
      unread_count: 0,
      contact_avatar_url: null,
      metadata: {},
    });
    const filtered = (read: number, fails: boolean) => {
      const filters: unknown[][] = [];
      conversationFilters[read - 1] = filters;
      const chain = {
        eq: (...args: unknown[]) => {
          filters.push(args);
          return chain;
        },
        maybeSingle: async () =>
          fails
            ? { data: null, error: { message: "timeout" } }
            : { data: conversationRow(), error: null },
      };
      return chain;
    };
    const conversations = {
      select: () => {
        conversationReads += 1;
        const read = conversationReads;
        return filtered(read, rereadFails && read === 2);
      },
      upsert: () => ({
        select: () => ({ single: async () => ({ data: conversationRow(), error: null }) }),
      }),
    };
    const messages = {
      // UPDATE de status, de exclusão e do eco: aceita qualquer filtro e não muda nada.
      update: () => {
        const chain = {
          eq: () => chain,
          in: async () => ({ data: null, error: null }),
          then: (resolve: (value: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
        };
        return chain;
      },
      // O eco sem track_id procura a mensagem pelo id do provedor (passo 3.1):
      // aqui ela nunca é conhecida, e o fluxo segue para a gravação.
      select: () => {
        const chain = {
          eq: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return chain;
      },
      upsert: (
        row: { id: string; direction: string; external_id: string | null },
        options?: { onConflict?: string; ignoreDuplicates?: boolean }
      ) => ({
        select: async (columns?: string) => {
          // Só um DO NOTHING com `select("id")` diz se inseriu. Sem ele o
          // PostgREST gera DO UPDATE, e o service_role não tem UPDATE em
          // direction/sender_type/conversation_id: toda mensagem daria 500.
          if (
            options?.onConflict !== "conversation_id,external_id" ||
            options.ignoreDuplicates !== true
          ) {
            return {
              data: null,
              error: { code: "42501", message: "permission denied for table chat_messages" },
            };
          }
          if (columns !== "id") throw new Error(`select inesperado: ${columns}`);
          if (insertFails) return { data: null, error: { message: "connection reset" } };
          if (storedExternalIds.has(row.external_id)) return { data: [], error: null };
          storedExternalIds.add(row.external_id);
          insertedRowIds.push(row.id);
          if (row.direction === "inbound" && conversationStatus === "resolved") {
            conversationStatus = "bot";
          }
          // Como o banco: devolve o id da linha que foi inserida.
          return { data: [{ id: row.id }], error: null };
        },
      }),
    };
    return {
      from: (table: string) => (table === "chat_messages" ? messages : conversations),
    };
  }

  /** O que o webhook entrega ao repasse quando a mensagem é de texto. */
  const relayed = (overrides: Record<string, unknown> = {}) => ({
    payload: inbound,
    conversationId: CONVERSATION_ID,
    contactId: "contact-1",
    // O id da linha que o banco inseriu (o gerado pelo webhook).
    messageId: insertedRowIds[0],
    media: null,
    // Para o repasse conferir que a credencial NÃO está no corpo.
    instanceToken: INSTANCE_TOKEN,
    ...overrides,
  });

  beforeEach(() => {
    conversationReads = 0;
    conversationFilters = [];
    storedExternalIds = new Set();
    insertedRowIds = [];
    adminClientMock.mockImplementation(() => fakeDatabase());
    identityMock.mockResolvedValue({
      contactId: "contact-1",
      normalizedPhone: "11999998888",
      created: false,
    });
    // Nada aqui pode sair para a rede: o repasse é de mentira.
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mensagem nova do cliente em conversa `bot`: repassa a conversa, o contato e a mensagem gravada", async () => {
    conversationStatus = "bot";

    const response = await POST(webhook(SECRET, inbound));
    await runAfter();

    expect(response.status).toBe(200);
    expect(relayMock).toHaveBeenCalledTimes(1);
    expect(relayMock).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(Function) }), relayed());
    // A mensagem repassada é a linha inserida, com o id que o webhook gerou.
    expect(insertedRowIds).toEqual([expect.stringMatching(UUID)]);
    expect(relayMock.mock.calls[0][1].messageId).toBe(insertedRowIds[0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o repasse fica para DEPOIS da resposta: o webhook responde 200 sem ter chamado o agente", async () => {
    conversationStatus = "bot";

    const response = await POST(webhook(SECRET, inbound));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // Agendado com after() (o Next o termina antes de sair num deploy), e ainda não rodou.
    expect(afterCallbacks).toHaveLength(1);
    expect(relayMock).not.toHaveBeenCalled();

    await runAfter();

    expect(relayMock).toHaveBeenCalledTimes(1);
  });

  it("conversa resolvida: a 1ª mensagem do cliente já vai para a IA", async () => {
    conversationStatus = "resolved";

    const response = await POST(webhook(SECRET, inbound));
    await runAfter();

    expect(response.status).toBe(200);
    expect(conversationStatus).toBe("bot");
    // Antes do upsert e depois do INSERT: é a 2ª que enxerga o `bot`.
    expect(conversationReads).toBe(2);
    // A releitura é da conversa do upsert, pelo id dela, e só por ele.
    expect(conversationFilters[1]).toEqual([["id", CONVERSATION_ID]]);
    expect(relayMock).toHaveBeenCalledTimes(1);
    expect(relayMock.mock.calls[0][1]).toEqual(relayed());
  });

  it("o envelope segue como chegou: quem tira o token da instância é o repasse", async () => {
    conversationStatus = "bot";
    const withToken = { ...inbound, owner: "5511900000000", token: "token-da-instancia" };

    await POST(webhook(SECRET, withToken));
    await runAfter();

    expect(relayMock.mock.calls[0][1]).toEqual(relayed({ payload: withToken }));
  });

  it("a mídia guardada no bucket vai junto, para o repasse assinar a URL", async () => {
    conversationStatus = "bot";
    const stored = {
      bucket: "chat-media",
      key: "chat/2026/10/abc.jpg",
      thumbKey: null,
      contentType: "image/jpeg",
      width: 800,
      height: 600,
    };
    downloadMock.mockResolvedValue({ fileURL: "https://inst.uazapi.test/files/abc.jpg", mimetype: "image/jpeg" });
    persistMediaMock.mockResolvedValue(stored);
    const image = {
      ...inbound,
      message: { ...inbound.message, messageid: "WA-IN-IMG", messageType: "ImageMessage", text: "" },
    };

    await POST(webhook(SECRET, image));
    await runAfter();

    expect(relayMock).toHaveBeenCalledTimes(1);
    expect(relayMock.mock.calls[0][1]).toEqual(relayed({ payload: image, media: stored }));
  });

  it("reenvio da mesma mensagem pela uazapi não vai de novo à IA, e fica no log", async () => {
    conversationStatus = "bot";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const first = await POST(webhook(SECRET, inbound));
    const retry = await POST(webhook(SECRET, inbound));
    await runAfter();

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(relayMock).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[webhook/uazapi] inbound repetido, sem relay:", {
      conversationId: CONVERSATION_ID,
    });
    info.mockRestore();
  });

  it("conversa com humano continua sem relay, e sem o log de repetido", async () => {
    conversationStatus = "human";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(webhook(SECRET, inbound));
    const retry = await POST(webhook(SECRET, inbound));
    await runAfter();

    expect(response.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(conversationStatus).toBe("human");
    expect(relayMock).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("mensagem do celular da empresa (fromMe) não é repassada", async () => {
    conversationStatus = "bot";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fromDevice = { ...inbound, message: { ...inbound.message, messageid: "WA-OUT-1", fromMe: true } };

    const response = await POST(webhook(SECRET, fromDevice));
    const retry = await POST(webhook(SECRET, fromDevice));
    await runAfter();

    expect(response.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(storedExternalIds.has("WA-OUT-1")).toBe(true);
    expect(relayMock).not.toHaveBeenCalled();
    // O "repetido" é só do que seria repassado.
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it.each([
    ["mensagem de grupo (isGroup)", { ...inbound, message: { ...inbound.message, isGroup: true } }],
    ["mensagem de grupo (chatid @g.us)", { ...inbound, message: { ...inbound.message, chatid: "120363000000000000@g.us" } }],
    ["confirmação de entrega", { EventType: "messages_update", event: { Type: "Delivered", MessageIDs: ["WA-IN-1"] } }],
    ["exclusão", { EventType: "messages_update", event: { Type: "Deleted", MessageIDs: ["WA-IN-1"] } }],
    [
      "eco do que o CRM enviou (fromMe + track_id)",
      { ...inbound, message: { ...inbound.message, fromMe: true, track_id: "66666666-6666-4666-8666-666666666666" } },
    ],
  ])("não repassa %s, mesmo com a conversa em `bot`", async (_label, body) => {
    conversationStatus = "bot";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(webhook(SECRET, body));
    await runAfter();

    expect(response.status).toBe(200);
    expect(relayMock).not.toHaveBeenCalled();
    expect(insertedRowIds).toEqual([]);
    info.mockRestore();
  });

  it("gravação da mensagem que falha: 500 para a uazapi reenviar, e nenhum repasse", async () => {
    conversationStatus = "bot";
    const database = fakeDatabase({ insertFails: true });
    adminClientMock.mockImplementation(() => database);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(webhook(SECRET, inbound));
    await runAfter();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(relayMock).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("releitura que falha em conversa resolvida: fica o status de antes, e não há relay", async () => {
    conversationStatus = "resolved";
    const database = fakeDatabase({ rereadFails: true });
    adminClientMock.mockImplementation(() => database);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(webhook(SECRET, inbound));
    await runAfter();

    expect(response.status).toBe(200);
    expect(storedExternalIds.has("WA-IN-1")).toBe(true);
    expect(relayMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("releitura que falha não derruba o webhook: fica o status de antes", async () => {
    conversationStatus = "bot";
    const database = fakeDatabase({ rereadFails: true });
    adminClientMock.mockImplementation(() => database);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(webhook(SECRET, inbound));
    await runAfter();

    expect(response.status).toBe(200);
    expect(conversationReads).toBe(2);
    expect(relayMock).toHaveBeenCalledTimes(1);
    expect(relayMock.mock.calls[0][1]).toEqual(relayed());
    expect(warn).toHaveBeenCalledWith(
      "[upsertMessage] reler o status da conversa falhou:",
      "timeout"
    );
    warn.mockRestore();
  });
});
