import { describe, expect, it } from "vitest";

import { formatBytes } from "@/lib/formatters/bytes";

describe("formatBytes", () => {
  it("mostra bytes inteiros abaixo de 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("arredonda o byte fracionário que vem de metadado", () => {
    expect(formatBytes(12.4)).toBe("12 B");
  });

  it("mostra KB inteiros, arredondados", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(820 * 1024)).toBe("820 KB");
    expect(formatBytes(1536)).toBe("2 KB");
    // Logo abaixo de 1 MB o arredondamento dá 1024 KB, como as cópias do chat.
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024 KB");
  });

  it("mostra MB com uma casa e ponto decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(64 * 1024 * 1024)).toBe("64.0 MB");
  });

  it("mostra GB com uma casa a partir de 1 GB", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(2.25 * 1024 ** 3)).toBe("2.3 GB");
  });

  it("não inventa tamanho para valor negativo ou não finito", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
  });
});
