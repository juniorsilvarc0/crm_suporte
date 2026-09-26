import { describe, expect, it } from "vitest";

import { buildMediaKey, extFromMime, thumbKeyFor } from "@/lib/storage/media-key";

describe("extFromMime", () => {
  it("resolve os tipos que o chat recebe", () => {
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("audio/mpeg")).toBe("mp3");
    expect(extFromMime("video/mp4")).toBe("mp4");
    expect(extFromMime("application/pdf")).toBe("pdf");
  });

  it("ignora parâmetro e caixa do mimetype", () => {
    expect(extFromMime("audio/webm; codecs=opus")).toBe("webm");
    expect(extFromMime("IMAGE/JPEG")).toBe("jpg");
  });

  it("tipo desconhecido não inventa extensão", () => {
    expect(extFromMime("application/x-coisa")).toBe("bin");
  });
});

describe("buildMediaKey", () => {
  // A razão de existir deste arquivo: o caminho antigo era
  // `5511990000024/inbound-<timestamp>.webp` num bucket público.
  it("não leva telefone nem nada do contato no caminho", () => {
    const key = buildMediaKey("chat", "webp");
    expect(key).not.toMatch(/\d{10,}/);
    expect(key).toMatch(/^chat\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/);
  });

  it("duas chamadas nunca colidem", () => {
    const keys = new Set(Array.from({ length: 200 }, () => buildMediaKey("chat", "jpg")));
    expect(keys.size).toBe(200);
  });

  it("sanitiza a pasta e nunca fica sem uma", () => {
    expect(buildMediaKey("../etc", "jpg")).toMatch(/^etc\//);
    expect(buildMediaKey("", "jpg")).toMatch(/^chat\//);
    expect(buildMediaKey("///", "jpg")).toMatch(/^chat\//);
  });
});

describe("thumbKeyFor", () => {
  it("mantém a miniatura ao lado do original na listagem", () => {
    expect(thumbKeyFor("chat/2026/08/abc.webp")).toBe("chat/2026/08/abc.thumb.webp");
  });

  it("chave sem extensão não vira nome quebrado", () => {
    expect(thumbKeyFor("chat/2026/08/abc")).toBe("chat/2026/08/abc.thumb");
  });

  it("só a ÚLTIMA extensão conta", () => {
    expect(thumbKeyFor("chat/2026/08/a.b.jpg")).toBe("chat/2026/08/a.b.thumb.jpg");
  });
});
