import { describe, expect, it } from "vitest";

import { isSlaMode } from "@/features/tickets/lib/sla-mode";

describe("isSlaMode", () => {
  it("aceita os 3 modos do check do banco", () => {
    expect(isSlaMode("running")).toBe(true);
    expect(isSlaMode("paused")).toBe(true);
    expect(isSlaMode("stopped")).toBe(true);
  });

  // O valor vem do banco: modo novo, caixa trocada ou chave do protótipo não
  // passam por modo conhecido.
  it("recusa o que não é um dos modos", () => {
    for (const value of ["", "Running", "pausado", "constructor", "toString", null, undefined, 0, {}]) {
      expect(isSlaMode(value)).toBe(false);
    }
  });
});
