import { describe, expect, it } from "vitest";

import { clientKeyFromRequest, rateLimit } from "@/lib/security/rate-limit";

describe("rateLimit", () => {
  it("permite até o limite e bloqueia a partir do excedente", () => {
    const key = "teste-limite";
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("conta cada chave (IP) de forma independente", () => {
    expect(rateLimit("chave-a", 1, 60_000).ok).toBe(true);
    expect(rateLimit("chave-a", 1, 60_000).ok).toBe(false);
    // outra chave começa do zero
    expect(rateLimit("chave-b", 1, 60_000).ok).toBe(true);
  });
});

describe("clientKeyFromRequest", () => {
  it("usa o primeiro IP do x-forwarded-for", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientKeyFromRequest(req)).toBe("203.0.113.7");
  });

  it("cai em 'unknown' quando não há IP", () => {
    expect(clientKeyFromRequest(new Request("http://x"))).toBe("unknown");
  });
});
