import { describe, expect, it } from "vitest";

import { formatNumber } from "@/lib/formatters/numbers";

describe("formatNumber", () => {
  it("formata milhar usando separador pt-BR", () => {
    expect(formatNumber(1000)).toBe("1.000");
  });

  it("formata número com casas decimais usando vírgula", () => {
    expect(formatNumber(1234567.891)).toBe("1.234.567,891");
  });

  it("formata zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formata número negativo", () => {
    expect(formatNumber(-1500)).toBe("-1.500");
  });
});
