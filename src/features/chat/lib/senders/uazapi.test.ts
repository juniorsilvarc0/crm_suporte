import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkUazapiNumber,
  sendUazapiText,
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
