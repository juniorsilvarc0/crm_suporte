import { describe, expect, it } from "vitest";

import { assertSafeUrl, safeBaseUrl } from "./ssrf-guard";

// Nota: em ambiente de teste NODE_ENV !== 'production', então http e localhost
// são liberados (facilita testes locais); faixas privadas seguem bloqueadas.

describe("assertSafeUrl", () => {
  it("aceita https público", () => {
    expect(() => assertSafeUrl("https://free.uazapi.com")).not.toThrow();
    expect(assertSafeUrl("https://free.uazapi.com").hostname).toBe("free.uazapi.com");
  });

  it("rejeita esquema não-http(s)", () => {
    expect(() => assertSafeUrl("ftp://exemplo.com")).toThrow();
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow();
  });

  it("rejeita URL malformada", () => {
    expect(() => assertSafeUrl("não é url")).toThrow();
    expect(() => assertSafeUrl("")).toThrow();
  });

  it("bloqueia faixas privadas IPv4", () => {
    expect(() => assertSafeUrl("https://10.0.0.5")).toThrow();
    expect(() => assertSafeUrl("https://192.168.1.1")).toThrow();
    expect(() => assertSafeUrl("https://172.16.0.9")).toThrow();
    expect(() => assertSafeUrl("https://172.31.255.1")).toThrow();
  });

  it("permite 172.15/172.32 (fora da faixa privada B)", () => {
    expect(() => assertSafeUrl("https://172.15.0.1")).not.toThrow();
    expect(() => assertSafeUrl("https://172.32.0.1")).not.toThrow();
  });

  it("bloqueia link-local / metadata (169.254.169.254)", () => {
    expect(() => assertSafeUrl("https://169.254.169.254")).toThrow();
  });

  it("bloqueia hostnames internos", () => {
    expect(() => assertSafeUrl("https://algo.local")).toThrow();
    expect(() => assertSafeUrl("https://servico.localhost")).toThrow();
  });

  it("bloqueia loopback IPv6", () => {
    expect(() => assertSafeUrl("https://[::1]")).toThrow();
  });

  it("bloqueia IPv4 mapeado em IPv6 (::ffff:) para host interno", () => {
    // new URL normaliza p/ a forma hex (::ffff:a9fe:a9fe / ::ffff:7f00:1)
    expect(() => assertSafeUrl("https://[::ffff:169.254.169.254]")).toThrow();
    expect(() => assertSafeUrl("https://[::ffff:127.0.0.1]")).toThrow();
    expect(() => assertSafeUrl("https://[::ffff:10.0.0.1]")).toThrow();
  });

  it("bloqueia IPv4 ofuscado (decimal e hex) apontando p/ rede privada", () => {
    // new URL normaliza host numérico p/ IPv4 dotted; a faixa privada é
    // bloqueada mesmo em dev (só localhost/127.0.0.1 é liberado de propósito).
    expect(() => assertSafeUrl("https://167772161")).toThrow(); // 10.0.0.1 decimal
    expect(() => assertSafeUrl("https://0x0a000001")).toThrow(); // 10.0.0.1 hex
  });

  it("bloqueia metadata da cloud em decimal", () => {
    // 169.254.169.254 = 2852039166
    expect(() => assertSafeUrl("https://2852039166")).toThrow();
  });

  it("permite localhost em dev (NODE_ENV != production)", () => {
    expect(() => assertSafeUrl("http://localhost:3000")).not.toThrow();
    expect(() => assertSafeUrl("http://127.0.0.1:8080")).not.toThrow();
  });
});

describe("safeBaseUrl", () => {
  it("normaliza removendo barra final", () => {
    expect(safeBaseUrl("https://x.uazapi.com/")).toBe("https://x.uazapi.com");
    expect(safeBaseUrl("https://x.uazapi.com///")).toBe("https://x.uazapi.com");
  });

  it("preserva subpath sem barra final", () => {
    expect(safeBaseUrl("https://x.uazapi.com/api/")).toBe("https://x.uazapi.com/api");
  });
});
