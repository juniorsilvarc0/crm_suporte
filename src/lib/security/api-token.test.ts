// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { generateApiToken, hashApiToken } from "@/lib/security/api-token";

describe("generateApiToken", () => {
  it("retorna token, hash e prefix", () => {
    const result = generateApiToken();
    expect(result).toHaveProperty("token");
    expect(result).toHaveProperty("hash");
    expect(result).toHaveProperty("prefix");
  });

  it("gera token que começa com o prefixo crmsuporte_", () => {
    const { token } = generateApiToken();
    expect(token.startsWith("crmsuporte_")).toBe(true);
  });

  it("prefix é igual aos 12 primeiros caracteres do token", () => {
    const { token, prefix } = generateApiToken();
    expect(prefix).toBe(token.slice(0, 12));
  });

  it("hash é o sha256 em hex do token (64 caracteres)", () => {
    const { token, hash } = generateApiToken();
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("gera tokens diferentes a cada chamada", () => {
    const first = generateApiToken();
    const second = generateApiToken();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
  });
});

describe("hashApiToken", () => {
  it("é determinística: o mesmo valor sempre gera o mesmo hash", () => {
    expect(hashApiToken("meu-token")).toBe(hashApiToken("meu-token"));
  });

  it("é igual ao sha256 hex calculado via node:crypto", () => {
    const value = "crmsuporte_qualquer-coisa-aqui";
    expect(hashApiToken(value)).toBe(
      createHash("sha256").update(value).digest("hex")
    );
  });

  it("gera hashes diferentes para entradas diferentes", () => {
    expect(hashApiToken("a")).not.toBe(hashApiToken("b"));
  });
});
