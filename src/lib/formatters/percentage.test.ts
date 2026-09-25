import { describe, expect, it } from "vitest";

import { formatPercentage, ratioPercentage } from "@/lib/formatters/percentage";

describe("formatPercentage", () => {
  it("arredonda e adiciona o símbolo de porcentagem", () => {
    expect(formatPercentage(45.4)).toBe("45%");
  });

  it("arredonda para cima quando fração é maior ou igual a 0.5", () => {
    expect(formatPercentage(45.5)).toBe("46%");
  });

  it("formata zero corretamente", () => {
    expect(formatPercentage(0)).toBe("0%");
  });

  it("formata números negativos", () => {
    expect(formatPercentage(-10.6)).toBe("-11%");
  });

  it("valor pequeno e não-zero NÃO vira 0% — 1 venda em 318 leads é 0,3%", () => {
    expect(formatPercentage((1 / 318) * 100)).toBe("0,3%");
  });

  it("mantém um dígito significativo em valores muito pequenos", () => {
    expect(formatPercentage(0.04)).toBe("0,04%");
  });

  it("meio ponto para cima volta ao inteiro", () => {
    expect(formatPercentage(0.5)).toBe("1%");
  });

  it("negativo pequeno também escapa do arredondamento", () => {
    expect(formatPercentage(-0.31)).toBe("-0,3%");
  });
});

describe("ratioPercentage", () => {
  it("calcula a porcentagem de part em relação a total", () => {
    expect(ratioPercentage(1, 4)).toBe(25);
  });

  it("retorna 0 quando total é zero", () => {
    expect(ratioPercentage(5, 0)).toBe(0);
  });

  it("retorna 0 quando total é negativo", () => {
    expect(ratioPercentage(5, -10)).toBe(0);
  });

  it("pode retornar valor acima de 100 quando part é maior que total", () => {
    expect(ratioPercentage(8, 4)).toBe(200);
  });
});
