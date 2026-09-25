import { describe, expect, it } from "vitest";

import {
  fromCents,
  netAmountCents,
  toCents,
} from "@/features/financeiro/lib/money";

describe("toCents", () => {
  it("converte reais em centavos", () => {
    expect(toCents(1850)).toBe(185000);
    expect(toCents(1850.5)).toBe(185050);
    expect(toCents(0.01)).toBe(1);
  });

  it("sobrevive ao erro de ponto flutuante", () => {
    // 19.9 * 100 === 1989.9999999999998 sem o arredondamento.
    expect(toCents(19.9)).toBe(1990);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1234.56)).toBe(123456);
  });

  it("trata ausência e valor inválido como zero", () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("fromCents", () => {
  it("volta para reais com duas casas", () => {
    expect(fromCents(185050)).toBe(1850.5);
    expect(fromCents(3333)).toBe(33.33);
    expect(fromCents(0)).toBe(0);
  });
});

describe("netAmountCents", () => {
  it("subtrai o desconto", () => {
    expect(netAmountCents(185000, 5000)).toBe(180000);
  });

  it("nunca fica negativo quando o desconto passa do total", () => {
    expect(netAmountCents(10000, 50000)).toBe(0);
  });

  it("sem desconto devolve o total", () => {
    expect(netAmountCents(185000, 0)).toBe(185000);
  });
});
