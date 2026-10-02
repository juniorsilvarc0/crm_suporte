import { afterEach, describe, expect, it, vi } from "vitest";

import { UnsafeUrlError } from "@/features/chat/lib/connection/ssrf-guard";
import {
  checkUazapiNumber,
  sendUazapiText,
  UazapiHttpError,
  uazapiSendDefinitelyFailed,
} from "@/features/chat/lib/senders/uazapi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendUazapiText", () => {
  it("ativa o preview automático e devolve os metadados do link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "uazapi-1",
          messageid: "wa-1",
          content: {
            extendedTextMessage: {
              title: "GitHub",
              description: "Plataforma de desenvolvimento",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendUazapiText(
      "https://inst.uazapi.com",
      "token-secreto",
      "+55 11 99999-0000",
      "Confira https://github.com/"
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      number: "5511999990000",
      text: "Confira https://github.com/",
      linkPreview: true,
    });
    expect(result.linkPreview).toMatchObject({
      url: "https://github.com/",
      title: "GitHub",
      description: "Plataforma de desenvolvimento",
    });
  });

  it("não envia linkPreview quando a mensagem não tem URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1", messageid: "2" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendUazapiText(
      "https://inst.uazapi.com",
      "token-secreto",
      "5511999990000",
      "Olá"
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("linkPreview");
  });
});

describe("sendUazapiText: o que a resposta do provedor quer dizer", () => {
  const respond = (body: string, status: number) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
    return sendUazapiText("https://inst.uazapi.com", "token-secreto", "5511999990000", "Olá");
  };
  const failure = (body: string, status: number) =>
    respond(body, status).then(
      () => {
        throw new Error("era para falhar");
      },
      (error: unknown) => error
    );

  it.each([
    ["null", "null"],
    ["um texto que não é JSON", "ok"],
    ["uma lista", "[]"],
    ["vazio", ""],
  ])("2xx com corpo %s é aceite: devolve sem ids, não lança", async (_label, body) => {
    await expect(respond(body, 200)).resolves.toEqual({ id: null, messageid: null });
  });

  it("a recusa do provedor lança com a mensagem de sempre, o status e o que o corpo do erro diz", async () => {
    const body = JSON.stringify({ error: "WhatsApp server error 463", error_source: "whatsapp_server", provider_code: 463 });

    const error = await failure(body, 500);

    expect(error).toBeInstanceOf(UazapiHttpError);
    expect(error).toMatchObject({
      message: `uazapi /send/text 500: ${body}`,
      status: 500,
      errorSource: "whatsapp_server",
      providerError: "WhatsApp server error 463",
    });
  });

  it.each([
    ["corpo que não é JSON", "<html>Bad Gateway</html>", null],
    ["JSON sem error_source", '{"error":"Failed to send message"}', "Failed to send message"],
    ["error_source e error que não são texto", '{"error_source":463,"error":{"code":1}}', null],
    ["JSON null", "null", null],
    ["JSON que é só um texto", '"No session"', null],
  ])("%s: a origem do erro fica nula", async (_label, body, providerError) => {
    expect(await failure(body, 502)).toMatchObject({ status: 502, errorSource: null, providerError });
  });

  it("URL que a guarda recusa lança antes de qualquer pedido", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await sendUazapiText("https://10.0.0.5", "token-secreto", "5511999990000", "Olá").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uazapiSendDefinitelyFailed(error)).toBe(true);
  });

  it("a mensagem do erro leva só os 200 primeiros caracteres do corpo", async () => {
    const error = (await failure("x".repeat(500), 400)) as Error;

    expect(error.message).toBe(`uazapi /send/text 400: ${"x".repeat(200)}`);
  });
});

describe("uazapiSendDefinitelyFailed", () => {
  const http = (status: number, source: string | null = null) => new UazapiHttpError(`uazapi /send/text ${status}`, status, source);
  const network = (code: unknown, error: Error = new TypeError("fetch failed")) =>
    Object.assign(error, { cause: Object.assign(new Error("causa"), { code }) });

  it.each([400, 401, 404, 429, 499])("recusa %d do provedor: a mensagem não saiu", (status) => {
    expect(uazapiSendDefinitelyFailed(http(status))).toBe(true);
  });

  it.each([304, 399, 500, 502, 503, 504])("resposta %d não diz se saiu", (status) => {
    expect(uazapiSendDefinitelyFailed(http(status))).toBe(false);
  });

  it("5xx em que o próprio WhatsApp recusou a mensagem: não saiu", () => {
    expect(uazapiSendDefinitelyFailed(http(500, "whatsapp_server"))).toBe(true);
    expect(uazapiSendDefinitelyFailed(http(500, "uazapi"))).toBe(false);
  });

  it.each(["No session", "WhatsApp client is not connected", "error editing chat notes: client is not connected", "NO SESSION"])(
    "5xx em que a uazapi diz que não há sessão (%s): não saiu",
    (text) => {
      expect(uazapiSendDefinitelyFailed(new UazapiHttpError("uazapi /send/text 500", 500, null, text))).toBe(true);
    }
  );

  it.each(["Failed to send message", "session expired while sending", "", null])(
    "5xx com outro texto (%s) não diz se saiu",
    (text) => {
      expect(uazapiSendDefinitelyFailed(new UazapiHttpError("uazapi /send/text 500", 500, null, text))).toBe(false);
    }
  );

  it("a URL que a guarda recusou: nenhum pedido saiu", () => {
    expect(uazapiSendDefinitelyFailed(new UnsafeUrlError("URL inválida."))).toBe(true);
  });

  it.each([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ])("nenhum pedido chegou ao provedor (%s): não saiu", (code) => {
    expect(uazapiSendDefinitelyFailed(network(code))).toBe(true);
  });

  it("vale o código da causa também quando o Node tentou vários endereços", () => {
    const cause = Object.assign(new AggregateError([new Error("a"), new Error("b")], "falhou"), { code: "ECONNREFUSED" });

    expect(uazapiSendDefinitelyFailed(Object.assign(new TypeError("fetch failed"), { cause }))).toBe(true);
  });

  it.each(["ECONNRESET", "UND_ERR_SOCKET", "EPIPE", "ETIMEDOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "", 111, null])(
    "a conexão caiu depois de aberta, ou não se sabe (%s): pode ter saído",
    (code) => {
      expect(uazapiSendDefinitelyFailed(network(code))).toBe(false);
    }
  );

  it.each([
    ["a demora além do limite", new DOMException("The operation was aborted due to timeout", "TimeoutError")],
    ["um erro sem causa", new Error("URL inválida.")],
    ["um erro cuja causa não é objeto", Object.assign(new Error("x"), { cause: "ECONNREFUSED" })],
    ["um erro cuja causa não tem código", Object.assign(new Error("x"), { cause: new Error("y") })],
    ["o que nem é um Error, ainda que pareça", { cause: { code: "ECONNREFUSED" } }],
    ["um texto", "ECONNREFUSED"],
    ["nada", undefined],
    ["null", null],
  ])("%s não prova que a mensagem deixou de sair", (_label, error) => {
    expect(uazapiSendDefinitelyFailed(error)).toBe(false);
  });
});

describe("checkUazapiNumber", () => {
  it("consulta o número informado e a alternativa com DDI brasileiro", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { query: "11990000001", jid: "", isInWhatsapp: false },
          {
            query: "5511990000001",
            jid: "5511990000001@s.whatsapp.net",
            isInWhatsapp: true,
            verifiedName: "Abner",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkUazapiNumber(
      "https://inst.uazapi.com",
      "token-secreto",
      "11 99000-0001"
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://inst.uazapi.com/chat/check");
    expect(init.headers).toMatchObject({ token: "token-secreto" });
    expect(JSON.parse(String(init.body))).toEqual({
      numbers: ["11990000001", "5511990000001"],
    });
    expect(result).toEqual({
      exists: true,
      phone: "5511990000001",
      jid: "5511990000001@s.whatsapp.net",
      verifiedName: "Abner",
    });
  });

  it("rejeita entrada que não tem tamanho de telefone", async () => {
    await expect(
      checkUazapiNumber("https://inst.uazapi.com", "token", "123")
    ).rejects.toThrow("Telefone inválido");
  });
});
