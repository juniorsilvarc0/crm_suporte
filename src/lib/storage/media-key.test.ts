import { describe, expect, it, vi } from "vitest";

import { buildMediaKey, extFromMime, thumbKeyFor } from "@/lib/storage/media-key";

/** A chave sem o UUID (aleatório): o resto do caminho não pode carregar dado do contato. */
const semUuid = (key: string) =>
  key.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, "<uuid>");

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
    expect(key).toMatch(/^chat\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/);
    expect(semUuid(key)).not.toMatch(/\d{10,}/);
  });

  // Regressão do teste instável: o UUID é aleatório e às vezes traz 10+
  // dígitos seguidos por acaso — o que não pode é telefone FORA dele.
  it("um UUID cheio de dígitos não é confundido com telefone", () => {
    const spy = vi.spyOn(crypto, "randomUUID").mockReturnValue("12345678-1234-4123-8123-123456789012");
    const key = buildMediaKey("chat", "webp");
    spy.mockRestore();
    expect(key).toMatch(/\d{10,}/);
    expect(semUuid(key)).not.toMatch(/\d{10,}/);
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
