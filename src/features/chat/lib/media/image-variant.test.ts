import { describe, expect, it } from "vitest";

import {
  CHAT_THUMB_WIDTH,
  chatImageDimensions,
  chatImageThumbUrl,
  chatThumbSrc,
} from "@/features/chat/lib/media/image-variant";

const PUBLIC =
  "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/chat-media/5511/inbound-1.jpg";

describe("chatImageThumbUrl", () => {
  it("troca o objeto público pelo transformador e pede a largura da bolha", () => {
    const url = new URL(chatImageThumbUrl(PUBLIC));

    expect(url.pathname).toBe(
      "/storage/v1/render/image/public/chat-media/5511/inbound-1.jpg"
    );
    expect(url.searchParams.get("width")).toBe(String(CHAT_THUMB_WIDTH));
    expect(url.searchParams.get("resize")).toBe("contain");
    expect(url.searchParams.get("quality")).toBe("75");
  });

  it("aceita largura própria", () => {
    expect(chatImageThumbUrl(PUBLIC, 320)).toContain("width=320");
  });

  // Quando o `persistInboundMedia` falha a mensagem fica com a URL do provedor.
  // Reescrever ali geraria um 404 e a foto sumiria da conversa.
  it("não mexe em mídia que ficou fora do nosso Storage", () => {
    const alheia = "https://mmg.whatsapp.net/v/t62/foto.enc?ccb=11-4";
    expect(chatImageThumbUrl(alheia)).toBe(alheia);
  });

  it("não mexe em data: URI nem em URL inválida", () => {
    expect(chatImageThumbUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA"
    );
    expect(chatImageThumbUrl("não é url")).toBe("não é url");
    expect(chatImageThumbUrl("")).toBe("");
  });

  it("preserva parâmetros que já vinham na URL", () => {
    expect(chatImageThumbUrl(`${PUBLIC}?t=123`)).toContain("t=123");
  });
});

describe("chatThumbSrc", () => {
  const R2 = "https://media.example.com/chat/2026/08/abc.webp";

  // Mídia nova: a miniatura é um arquivo de verdade, gravado na entrada.
  it("prefere a miniatura gravada no metadata", () => {
    expect(
      chatThumbSrc(R2, { thumbUrl: "https://media.example.com/chat/2026/08/abc.thumb.webp" })
    ).toBe("https://media.example.com/chat/2026/08/abc.thumb.webp");
  });

  // Acervo antigo: continua no Supabase, e lá o transformador existe.
  it("sem miniatura gravada, cai no transformador do Supabase", () => {
    expect(chatThumbSrc(PUBLIC, null)).toContain("/render/image/public/");
  });

  it("mídia do R2 sem miniatura devolve a própria imagem", () => {
    expect(chatThumbSrc(R2, {})).toBe(R2);
  });

  it("ignora `thumbUrl` que não é URL", () => {
    expect(chatThumbSrc(R2, { thumbUrl: 123 })).toBe(R2);
    expect(chatThumbSrc(R2, { thumbUrl: "" })).toBe(R2);
    expect(chatThumbSrc(R2, { thumbUrl: "javascript:alert(1)" })).toBe(R2);
  });
});

describe("chatImageDimensions", () => {
  it("lê as dimensões gravadas pelo webhook", () => {
    expect(chatImageDimensions({ mediaWidth: 738, mediaHeight: 1600 })).toEqual({
      width: 738,
      height: 1600,
    });
  });

  // Mensagem anterior a esta mudança não tem o campo. Sem palpite de proporção:
  // sem atributo, exatamente como era antes.
  it("devolve null quando a mensagem não tem o dado", () => {
    expect(chatImageDimensions(null)).toBeNull();
    expect(chatImageDimensions(undefined)).toBeNull();
    expect(chatImageDimensions({})).toBeNull();
    expect(chatImageDimensions({ linkPreview: { url: "x" } })).toBeNull();
  });

  it("rejeita número que não serve de dimensão", () => {
    expect(chatImageDimensions({ mediaWidth: "738", mediaHeight: 1600 })).toBeNull();
    expect(chatImageDimensions({ mediaWidth: 0, mediaHeight: 1600 })).toBeNull();
    expect(chatImageDimensions({ mediaWidth: -1, mediaHeight: 1600 })).toBeNull();
    expect(chatImageDimensions({ mediaWidth: NaN, mediaHeight: 1600 })).toBeNull();
  });
});
