// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { enqueueMock, claimMock, settleMock, retryMock, relayMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  claimMock: vi.fn(),
  settleMock: vi.fn(),
  retryMock: vi.fn(() => "RETRY-AT"),
  relayMock: vi.fn(),
}));

vi.mock("@/features/integrations/server/outbox", () => ({
  enqueueOutbox: enqueueMock,
  claimOutbox: claimMock,
  settleOutbox: settleMock,
  outboxRetryAt: retryMock,
}));
// envelopeLeaksToken é o DE VERDADE (é a garantia que estamos testando); só a
// entrega de um evento é de mentira.
vi.mock("@/features/integrations/server/relay-message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/integrations/server/relay-message")>()),
  relayInboundMessage: relayMock,
}));

import {
  dispatchRelayBatch,
  enqueueRelay,
} from "@/features/integrations/server/relay-dispatch";

const supabase = {} as never;

const INSTANCE_TOKEN = "3f1c9a7e-5b2d-4c8f-9e6a-0d4b7c2e1f58";
const MESSAGE_ID = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";

const basePayload = {
  EventType: "messages",
  instanceName: "suporte",
  token: INSTANCE_TOKEN,
  message: {
    messageid: "WA-IN-1",
    chatid: "5527999990000@s.whatsapp.net",
    fromMe: false,
    messageType: "Conversation",
    text: "O sistema travou",
  },
};

type Delivery = Parameters<typeof enqueueRelay>[1];
const delivery = (overrides: Partial<Delivery> = {}): Delivery =>
  ({
    payload: basePayload,
    conversationId: "conv-1",
    contactId: "contact-1",
    messageId: MESSAGE_ID,
    media: null,
    instanceToken: INSTANCE_TOKEN,
    ...overrides,
  }) as Delivery;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  retryMock.mockReturnValue("RETRY-AT");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueRelay", () => {
  it("enfileira em 'relay', chaveado por messageId, com o envelope sem token", async () => {
    enqueueMock.mockResolvedValue("evt-1");

    const ok = await enqueueRelay(supabase, delivery());

    expect(ok).toBe(true);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [, arg] = enqueueMock.mock.calls[0] as [unknown, { kind: string; eventKey: string; payload: Record<string, unknown> }];
    expect(arg.kind).toBe("relay");
    expect(arg.eventKey).toBe(MESSAGE_ID);
    expect(arg.payload).toMatchObject({
      conversation_id: "conv-1",
      contact_id: "contact-1",
      message_id: MESSAGE_ID,
      media: null,
    });
    expect(arg.payload.envelope).not.toHaveProperty("token");
    // A credencial não está em lugar nenhum do que foi gravado.
    expect(JSON.stringify(arg.payload)).not.toContain(INSTANCE_TOKEN);
  });

  it("guarda a mídia só como bucket/key (ignora o resto)", async () => {
    enqueueMock.mockResolvedValue("evt-1");

    await enqueueRelay(
      supabase,
      delivery({ media: { bucket: "chat-media", key: "a/b.ogg", extra: "ignorado" } as never })
    );

    const [, arg] = enqueueMock.mock.calls[0] as [unknown, { payload: { media: unknown } }];
    expect(arg.payload.media).toEqual({ bucket: "chat-media", key: "a/b.ogg" });
  });

  it("enqueueOutbox devolve null → false", async () => {
    enqueueMock.mockResolvedValue(null);
    expect(await enqueueRelay(supabase, delivery())).toBe(false);
  });
});

describe("enqueueRelay: a credencial da instância não é enfileirada (fail-closed)", () => {
  it.each([
    ["dentro da mensagem", { ...basePayload, message: { ...basePayload.message, instance: { token: INSTANCE_TOKEN } } }],
    ["numa chave de raiz com outro nome", { ...basePayload, apikey: INSTANCE_TOKEN }],
    ["no meio de um texto", { ...basePayload, chat: { note: `use ${INSTANCE_TOKEN} para enviar` } }],
  ])("token %s: não enfileira, devolve false, e o motivo no log não traz o token", async (_label, hostile) => {
    const ok = await enqueueRelay(supabase, delivery({ payload: hostile as Delivery["payload"] }));

    expect(ok).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(INSTANCE_TOKEN);
  });

  it("token com caractere que o JSON escapa também é achado", async () => {
    const odd = 'tok"en\\com-aspas-e-barra-0001';

    const ok = await enqueueRelay(
      supabase,
      delivery({ instanceToken: odd, payload: { ...basePayload, token: undefined, chat: { k: odd } } as Delivery["payload"] })
    );

    expect(ok).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("token curto demais (<16) não bloqueia; o token de raiz some assim mesmo", async () => {
    enqueueMock.mockResolvedValue("evt-1");

    const ok = await enqueueRelay(
      supabase,
      delivery({
        instanceToken: "token",
        payload: { ...basePayload, token: "token", message: { ...basePayload.message, text: "qual é o token?" } } as Delivery["payload"],
      })
    );

    expect(ok).toBe(true);
    const [, arg] = enqueueMock.mock.calls[0] as [unknown, { payload: { envelope: { message: { text: string } } } }];
    expect(arg.payload.envelope).not.toHaveProperty("token");
    expect(arg.payload.envelope.message.text).toBe("qual é o token?");
  });

  it("15 caracteres ainda é curto; 16 já bloqueia", async () => {
    enqueueMock.mockResolvedValue("evt-1");
    const short = "a1b2c3d4e5f6g7h"; // 15

    expect(
      await enqueueRelay(supabase, delivery({ instanceToken: short, payload: { ...basePayload, chat: { k: short } } as Delivery["payload"] }))
    ).toBe(true);

    enqueueMock.mockClear();
    const long = `${short}8`; // 16
    expect(
      await enqueueRelay(supabase, delivery({ instanceToken: long, payload: { ...basePayload, chat: { k: long } } as Delivery["payload"] }))
    ).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

const event = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "evt-1",
    kind: "relay",
    event_key: MESSAGE_ID,
    payload: {
      envelope: { EventType: "messages", message: { text: "oi" } },
      conversation_id: "conv-1",
      contact_id: "contact-1",
      message_id: MESSAGE_ID,
      media: null,
    },
    status: "processing",
    attempts: 1,
    lease_token: "lease-1",
    ...overrides,
  }) as never;

describe("dispatchRelayBatch", () => {
  it("claim vazio: não entrega nem finaliza", async () => {
    claimMock.mockResolvedValue([]);
    await dispatchRelayBatch(supabase);
    expect(relayMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("sucesso: reconstrói a mensagem (sem token) e finaliza 'sent'", async () => {
    claimMock.mockResolvedValue([event()]);
    relayMock.mockResolvedValue({ error: null, httpStatus: 200, latencyMs: 12 });

    await dispatchRelayBatch(supabase);

    expect(relayMock).toHaveBeenCalledWith(supabase, {
      payload: { EventType: "messages", message: { text: "oi" } },
      conversationId: "conv-1",
      contactId: "contact-1",
      messageId: MESSAGE_ID,
      media: null,
    });
    expect(settleMock).toHaveBeenCalledWith(supabase, {
      id: "evt-1",
      leaseToken: "lease-1",
      status: "sent",
      httpStatus: 200,
    });
  });

  it("sem confirmação: finaliza 'retry' com o próximo prazo do backoff", async () => {
    claimMock.mockResolvedValue([event({ attempts: 2 })]);
    relayMock.mockResolvedValue({ error: "O agente não respondeu em 10 s." });

    await dispatchRelayBatch(supabase);

    expect(retryMock).toHaveBeenCalledWith(2, expect.any(Number));
    expect(settleMock).toHaveBeenCalledWith(supabase, {
      id: "evt-1",
      leaseToken: "lease-1",
      status: "retry",
      nextAttemptAt: "RETRY-AT",
      httpStatus: null,
      error: "O agente não respondeu em 10 s.",
    });
  });

  it("sem agente (null): finaliza 'skipped'", async () => {
    claimMock.mockResolvedValue([event()]);
    relayMock.mockResolvedValue(null);

    await dispatchRelayBatch(supabase);

    expect(settleMock).toHaveBeenCalledWith(supabase, {
      id: "evt-1",
      leaseToken: "lease-1",
      status: "skipped",
      error: "sem agente configurado",
    });
  });

  it("payload corrompido: 'dead_letter' sem tentar entregar", async () => {
    claimMock.mockResolvedValue([event({ payload: { lixo: true } })]);

    await dispatchRelayBatch(supabase);

    expect(relayMock).not.toHaveBeenCalled();
    expect(settleMock).toHaveBeenCalledWith(supabase, {
      id: "evt-1",
      leaseToken: "lease-1",
      status: "dead_letter",
      error: "payload do outbox inválido",
    });
  });

  it("evento sem lease_token: ignora (defensivo, não finaliza)", async () => {
    claimMock.mockResolvedValue([event({ lease_token: null })]);

    await dispatchRelayBatch(supabase);

    expect(relayMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });
});
