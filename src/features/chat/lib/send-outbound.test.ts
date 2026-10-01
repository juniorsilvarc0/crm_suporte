// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendTextMock, credentialsMock } = vi.hoisted(() => ({
  sendTextMock: vi.fn(),
  credentialsMock: vi.fn(),
}));
// O provedor e a credencial são SEMPRE de mentira: nenhum teste fala com o WhatsApp.
vi.mock("@/features/chat/lib/senders/uazapi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chat/lib/senders/uazapi")>()),
  sendUazapiText: sendTextMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({ getIntegrationCredentials: credentialsMock }));

import { sendOutboundText, type SendOutboundTextInput } from "@/features/chat/lib/send-outbound";

// O envio de texto sem rota nenhuma: o que ele lê e grava em chat_messages, na
// ORDEM e com os filtros. As rotas (sessão e API v1) conferem o desfecho; aqui
// fica o protocolo com o banco, que as duas compartilham.

type Step = [string, ...unknown[]];
type Result = { data?: unknown; error?: unknown };

const steps: Step[] = [];
const results: Result[] = [];

/** Supabase de mentira: um resultado enfileirado por `from()`, e cada chamada registrada. */
const supabase = {
  from: (table: string) => {
    const result = results.shift();
    if (!result) throw new Error(`sem resultado enfileirado para ${table}`);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "eq", "in", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        steps.push([method, ...args]);
        return chain;
      };
    }
    chain.single = async () => result;
    chain.maybeSingle = async () => result;
    chain.then = (ok: (value: Result) => unknown, fail?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(ok, fail);
    return chain;
  },
} as unknown as Parameters<typeof sendOutboundText>[0];

const CONV = "conversation-1";
const NOW = "2026-10-01T12:00:00.000Z";
const PHONE = "5500900001111";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "message-1",
  conversation_id: CONV,
  content: "*Ana:*\nOlá",
  delivery_status: "pending",
  is_deleted: false,
  quoted_message_id: null,
  external_id: null,
  sent_by_user_id: "user-1",
  sent_by_token_id: null,
  metadata: { clientId: "abc-123" },
  ...overrides,
});

const input = (overrides: Partial<SendOutboundTextInput> = {}): SendOutboundTextInput => ({
  conversation: { id: CONV, external_id: PHONE, contact_phone: null, integration_id: "integration-1" },
  content: "Olá",
  finalize: (text) => `*Ana:*\n${text}`,
  clientId: "abc-123",
  quotedMessageId: null,
  author: { kind: "user", userId: "user-1" },
  now: NOW,
  ...overrides,
});

const send = (overrides: Partial<SendOutboundTextInput> = {}) => sendOutboundText(supabase, input(overrides));
const wrote = () => steps.some(([name]) => name === "insert" || name === "update");
const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
const sent = row({ delivery_status: "sent", external_id: "provider-1" });

/** Os resultados de um 1º envio que dá certo: busca pela chave, insert, id do provedor, sent, releitura. */
const firstSend = (final: Result = { data: sent, error: null }) =>
  results.push({ data: null, error: null }, { data: row(), error: null }, { error: null }, { error: null }, final);

beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
  results.length = 0;
  sendTextMock.mockResolvedValue({ id: "uazapi-1", messageid: "provider-1" });
  credentialsMock.mockResolvedValue({ id: "integration-1", apiUrl: "https://api.uazapi.test", token: "token", phone_number: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendOutboundText: o 1º envio", () => {
  it("busca a chave, grava pending com o autor, manda, carimba o id do provedor, vira sent e relê a linha", async () => {
    firstSend();

    expect(await send()).toEqual({ ok: true, outcome: "sent", message: sent });
    expect(steps).toEqual([
      ["select"],
      ["eq", "conversation_id", CONV],
      ["eq", "metadata->>clientId", "abc-123"],
      ["limit", 1],
      [
        "insert",
        {
          conversation_id: CONV,
          direction: "outbound",
          sender_type: "agent",
          type: "text",
          content: "*Ana:*\nOlá",
          quoted_message_id: null,
          metadata: { clientId: "abc-123" },
          delivery_status: "pending",
          sent_by_user_id: "user-1",
          created_at: NOW,
        },
      ],
      ["select"],
      ["update", { external_id: "provider-1", metadata: { clientId: "abc-123", uazapiId: "uazapi-1" } }],
      ["eq", "id", "message-1"],
      ["update", { delivery_status: "sent" }],
      ["eq", "id", "message-1"],
      // Monótono: um delivered/read que chegou durante o envio não regride.
      ["in", "delivery_status", ["pending"]],
      ["select"],
      ["eq", "id", "message-1"],
    ]);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).toHaveBeenCalledWith("https://api.uazapi.test", "token", PHONE, "*Ana:*\nOlá", {
      trackId: "message-1",
      replyId: null,
    });
    expect(credentialsMock).toHaveBeenCalledWith(supabase, "integration-1");
  });

  it("sem clientId não busca nem grava a chave", async () => {
    results.push({ data: row({ metadata: {} }), error: null }, { error: null }, { error: null }, { data: sent, error: null });

    await send({ clientId: null });

    expect(steps[0]?.[0]).toBe("insert");
    expect((steps[0]?.[1] as { metadata?: unknown }).metadata).toEqual({});
    expect(steps.find(([name]) => name === "update")?.[1]).toEqual({
      external_id: "provider-1",
      metadata: { uazapiId: "uazapi-1" },
    });
  });

  it("texto com link: a prévia entra na linha, e a do provedor prevalece depois do envio", async () => {
    firstSend();
    const provider = { url: "https://ajuda.exemplo.com/boleto", siteName: "ajuda.exemplo.com", title: "Segunda via" };
    sendTextMock.mockResolvedValue({ id: "uazapi-1", messageid: "provider-1", linkPreview: provider });

    await send({ content: "Veja https://ajuda.exemplo.com/boleto", finalize: (text) => text });

    expect((steps.find(([name]) => name === "insert")?.[1] as { metadata?: unknown }).metadata).toEqual({
      clientId: "abc-123",
      linkPreview: { url: "https://ajuda.exemplo.com/boleto", siteName: "ajuda.exemplo.com" },
    });
    expect(steps.find(([name]) => name === "update")?.[1]).toEqual({
      external_id: "provider-1",
      metadata: { clientId: "abc-123", uazapiId: "uazapi-1", linkPreview: provider },
    });
  });

  it("responder: a citada é procurada só dentro da conversa, e o provedor recebe o id DELE", async () => {
    results.push(
      { data: null, error: null },
      { data: { id: "quoted-1", external_id: "provider-quoted" }, error: null },
      { data: row({ quoted_message_id: "quoted-1" }), error: null },
      { error: null },
      { error: null },
      { data: sent, error: null }
    );

    await send({ quotedMessageId: "quoted-1" });

    expect(steps.slice(4, 7)).toEqual([["select", "id, external_id"], ["eq", "id", "quoted-1"], ["eq", "conversation_id", CONV]]);
    expect(steps.find(([name]) => name === "insert")?.[1]).toMatchObject({ quoted_message_id: "quoted-1" });
    expect(sendTextMock.mock.calls[0]?.[4]).toEqual({ trackId: "message-1", replyId: "provider-quoted" });
  });

  it("releitura que falha depois do envio: devolve a linha como foi gravada", async () => {
    firstSend({ data: null, error: { message: "timeout" } });

    expect(await send()).toEqual({ ok: true, outcome: "sent", message: row() });
    expect(sendTextMock).toHaveBeenCalledTimes(1);
  });

  it("erro ao carimbar o id do provedor ou o sent não derruba o envio já aceito: loga os dois", async () => {
    results.push(
      { data: null, error: null },
      { data: row(), error: null },
      { error: { message: "external_id" } },
      { error: { message: "delivery_status" } },
      { data: row(), error: null }
    );
    const log = silence();

    expect(await send()).toMatchObject({ ok: true, outcome: "sent" });
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe("sendOutboundText: o que não sai", () => {
  it("sem endereço do canal não busca a credencial; sem credencial não toca chat_messages", async () => {
    const blank = { id: CONV, external_id: " ", contact_phone: null, integration_id: "integration-1" };
    expect(await send({ conversation: blank })).toEqual({ ok: false, reason: "no_phone" });
    expect(credentialsMock).not.toHaveBeenCalled();

    credentialsMock.mockResolvedValue(null);
    expect(await send()).toEqual({ ok: false, reason: "no_integration" });
    expect(steps).toEqual([]);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("citada que não está na conversa: quoted_not_found, sem gravar nem mandar", async () => {
    results.push({ data: null, error: null }, { data: null, error: null });

    expect(await send({ quotedMessageId: "de-outra-conversa" })).toEqual({ ok: false, reason: "quoted_not_found" });
    expect(wrote()).toBe(false);
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("erro do banco no INSERT lança, sem mandar", async () => {
    results.push({ data: null, error: null }, { data: null, error: { code: "23514", message: "check" } });

    await expect(send()).rejects.toMatchObject({ code: "23514" });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("INSERT barrado (23505) e a linha de quem ganhou sumiu: lança o erro do banco, sem mandar", async () => {
    results.push({ data: null, error: null }, { data: null, error: { code: "23505" } }, { data: null, error: null });

    await expect(send()).rejects.toMatchObject({ code: "23505" });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("provedor falhou (analista): só esta linha vira failed, e só a partir de pending", async () => {
    results.push({ data: null, error: null }, { data: row(), error: null }, { error: null });
    sendTextMock.mockRejectedValue(new Error("uazapi fora do ar"));
    const log = silence();

    expect(await send()).toEqual({ ok: false, reason: "provider_failed" });
    expect(steps.slice(-3)).toEqual([
      ["update", { delivery_status: "failed" }],
      ["eq", "id", "message-1"],
      ["in", "delivery_status", ["pending"]],
    ]);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("sendOutboundText: o reenvio da linha que falhou", () => {
  it("valem o texto e a citação da LINHA, a assinatura não roda de novo, e só ela volta a pending", async () => {
    const failed = row({ delivery_status: "failed", content: "*Ana:*\nTexto da 1ª tentativa", quoted_message_id: "quoted-1" });
    results.push(
      { data: failed, error: null },
      { data: { id: "quoted-1", external_id: "provider-quoted" }, error: null },
      { data: { ...failed, delivery_status: "pending" }, error: null },
      { error: null },
      { error: null },
      { data: { ...failed, delivery_status: "sent" }, error: null }
    );
    const finalize = vi.fn((text: string) => `*Ana:*\n${text}`);

    const result = await send({ content: "outro texto", quotedMessageId: "outra-citada", finalize });

    expect(result).toEqual({ ok: true, outcome: "sent", message: { ...failed, delivery_status: "sent" } });
    expect(finalize).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledWith("https://api.uazapi.test", "token", PHONE, "*Ana:*\nTexto da 1ª tentativa", {
      trackId: "message-1",
      replyId: "provider-quoted",
    });
    expect(steps.some(([name]) => name === "insert")).toBe(false);
    expect(steps).toContainEqual(["eq", "id", "quoted-1"]);
    // Só a linha que falhou volta a pending: é o filtro que barra dois reenvios simultâneos.
    const flip = steps.findIndex(
      ([name, values]) => name === "update" && (values as { delivery_status?: string }).delivery_status === "pending"
    );
    expect(steps.slice(flip, flip + 3)).toEqual([
      ["update", { delivery_status: "pending" }],
      ["eq", "id", "message-1"],
      ["eq", "delivery_status", "failed"],
    ]);
  });

  it("a linha sumiu entre a busca e o reenvio: lança, sem mandar", async () => {
    results.push({ data: row({ delivery_status: "failed" }), error: null }, { data: null, error: null }, { data: null, error: null });

    await expect(send()).rejects.toThrow("insert failed");
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});
