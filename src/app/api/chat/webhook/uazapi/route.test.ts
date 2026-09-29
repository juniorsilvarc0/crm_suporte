// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, integrationMock, secretMock, identityMock, relayUrlMock } = vi.hoisted(
  () => ({
    adminClientMock: vi.fn(),
    integrationMock: vi.fn(),
    secretMock: vi.fn(),
    identityMock: vi.fn(),
    relayUrlMock: vi.fn(),
  })
);

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
vi.mock("@/features/settings/lib/get-relay-url", () => ({
  getRelayUrl: relayUrlMock,
}));

import { POST } from "@/app/api/chat/webhook/uazapi/route";

const SECRET = "a".repeat(64);

function webhook(secret: string | null, body: unknown = { EventType: "presence" }) {
  const query = secret === null ? "" : `?s=${encodeURIComponent(secret)}`;
  return new Request(`http://x/api/chat/webhook/uazapi${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adminClientMock.mockReturnValue({});
  integrationMock.mockResolvedValue({
    id: "int-1",
    apiUrl: "https://inst.uazapi.test",
    token: "token",
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
  const RELAY_URL = "https://relay.test/hook";

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
  let fetchMock: ReturnType<typeof vi.fn>;

  // O banco nas partes que o upsertMessage toca. O INSERT da mensagem faz o
  // que o trigger increment_unread faz com o status (migration _tickets §10.1):
  // inbound em `resolved` volta para `bot`. Como no banco, um `external_id` já
  // gravado não insere nem devolve linha, e o trigger não roda. `rereadFails`
  // derruba a 2ª leitura da conversa (a releitura depois do INSERT). O fake
  // devolve a mesma linha qualquer que seja o filtro: quem confere o filtro é
  // o teste.
  function fakeDatabase({ rereadFails = false } = {}) {
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
      upsert: (
        row: { direction: string; external_id: string | null },
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
          if (storedExternalIds.has(row.external_id)) return { data: [], error: null };
          storedExternalIds.add(row.external_id);
          if (row.direction === "inbound" && conversationStatus === "resolved") {
            conversationStatus = "bot";
          }
          return { data: [{ id: "message-1" }], error: null };
        },
      }),
    };
    return {
      from: (table: string) => (table === "chat_messages" ? messages : conversations),
    };
  }

  beforeEach(() => {
    conversationReads = 0;
    conversationFilters = [];
    storedExternalIds = new Set();
    adminClientMock.mockImplementation(() => fakeDatabase());
    identityMock.mockResolvedValue({
      contactId: "contact-1",
      normalizedPhone: "11999998888",
      created: false,
    });
    relayUrlMock.mockResolvedValue(RELAY_URL);
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("conversa resolvida: a 1ª mensagem do cliente já vai para a IA", async () => {
    conversationStatus = "resolved";

    const response = await POST(webhook(SECRET, inbound));

    expect(response.status).toBe(200);
    expect(conversationStatus).toBe("bot");
    // Antes do upsert e depois do INSERT: é a 2ª que enxerga o `bot`.
    expect(conversationReads).toBe(2);
    // A releitura é da conversa do upsert, pelo id dela, e só por ele.
    expect(conversationFilters[1]).toEqual([["id", CONVERSATION_ID]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      RELAY_URL,
      expect.objectContaining({ method: "POST", body: JSON.stringify(inbound) })
    );
  });

  it("o relay não leva o token da instância; o resto do envelope vai igual", async () => {
    conversationStatus = "bot";
    const withToken = { ...inbound, owner: "5511900000000", token: "token-da-instancia" };

    await POST(webhook(SECRET, withToken));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(String(init.body));
    expect(sent).not.toHaveProperty("token");
    expect(String(init.body)).not.toContain("token-da-instancia");
    expect(sent).toEqual({ ...inbound, owner: "5511900000000" });
  });

  it("reenvio da mesma mensagem pela uazapi não vai de novo à IA, e fica no log", async () => {
    conversationStatus = "bot";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const first = await POST(webhook(SECRET, inbound));
    const retry = await POST(webhook(SECRET, inbound));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[webhook/uazapi] inbound repetido, sem relay:", {
      conversationId: CONVERSATION_ID,
    });
    info.mockRestore();
  });

  it("o relay tem prazo de 10 s: um agente que não responde não fica pendurado", async () => {
    conversationStatus = "bot";
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await POST(webhook(SECRET, inbound));

    expect(timeout).toHaveBeenCalledWith(10_000);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(timeout.mock.results[0].value);
    timeout.mockRestore();
  });

  it("conversa com humano continua sem relay", async () => {
    conversationStatus = "human";

    const response = await POST(webhook(SECRET, inbound));

    expect(response.status).toBe(200);
    expect(conversationStatus).toBe("human");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releitura que falha não derruba o webhook: fica o status de antes", async () => {
    conversationStatus = "bot";
    const database = fakeDatabase({ rereadFails: true });
    adminClientMock.mockImplementation(() => database);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(webhook(SECRET, inbound));

    expect(response.status).toBe(200);
    expect(conversationReads).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[upsertMessage] reler o status da conversa falhou:",
      "timeout"
    );
    warn.mockRestore();
  });
});
