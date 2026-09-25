// @vitest-environment node
import { describe, expect, it } from "vitest";

import { safeEqual } from "@/lib/security/safe-equal";

describe("safeEqual", () => {
  it("aceita o mesmo segredo", () => {
    expect(safeEqual("a1b2c3", "a1b2c3")).toBe(true);
  });

  it("recusa segredo diferente de mesmo tamanho", () => {
    expect(safeEqual("a1b2c3", "a1b2c4")).toBe(false);
  });

  it("recusa prefixo e tamanhos diferentes sem lançar", () => {
    expect(safeEqual("a1b2", "a1b2c3")).toBe(false);
    expect(safeEqual("", "a1b2c3")).toBe(false);
  });
});
