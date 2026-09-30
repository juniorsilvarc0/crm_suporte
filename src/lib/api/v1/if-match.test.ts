// @vitest-environment node
import { describe, expect, it } from "vitest";

import { etagFor, parseIfMatch } from "@/lib/api/v1/if-match";

const withHeader = (value?: string) =>
  new Request("http://crm.test/x", { headers: value === undefined ? {} : { "If-Match": value } });

describe("If-Match da API v1", () => {
  it("o ETag é fraco, com a versão", () => {
    expect(etagFor(7)).toBe('W/"7"');
  });

  it.each([
    ['W/"3"', 3],
    ['"3"', 3],
    ['  W/"42"  ', 42],
    ['W/"2147483647"', 2147483647],
  ])("aceita %s", (value, version) => {
    expect(parseIfMatch(withHeader(value))).toEqual({ ok: true, version });
  });

  it("ausente (ou vazio) é missing: a rota responde 428", () => {
    expect(parseIfMatch(withHeader())).toEqual({ ok: false, reason: "missing" });
    expect(parseIfMatch(withHeader("  "))).toEqual({ ok: false, reason: "missing" });
  });

  it.each([
    ["curinga", "*"],
    ["sem aspas", "3"],
    ["lista de ETags", 'W/"3", W/"4"'],
    ["zero", 'W/"0"'],
    ["zero à esquerda", 'W/"03"'],
    ["negativo", 'W/"-1"'],
    ["texto", 'W/"abc"'],
    ["acima do integer do Postgres", 'W/"2147483648"'],
  ])("recusa %s", (_label, value) => {
    expect(parseIfMatch(withHeader(value))).toEqual({ ok: false, reason: "invalid" });
  });
});
