import { describe, expect, it } from "vitest";

import {
  EMPTY_SALE_RANGE,
  hasSaleFilter,
  matchesSaleFilter,
  summarizeLeadSales,
} from "@/features/financeiro/lib/lead-sale-summary";
import type { LeadSale } from "@/features/financeiro/types";

function sale(netAmount: number, status: LeadSale["status"] = "quitado"): LeadSale {
  return {
    id: `s-${netAmount}-${status}`,
    leadId: "lead-1",
    procedureName: "Rezum",
    totalAmount: netAmount,
    discount: 0,
    netAmount,
    status,
    createdAt: "2026-08-01T12:00:00.000Z",
    notes: null,
    method: "pix",
  };
}

describe("summarizeLeadSales", () => {
  it("sem venda devolve resumo zerado", () => {
    expect(summarizeLeadSales([])).toEqual({ count: 0, total: 0, hasSale: false });
    expect(summarizeLeadSales(undefined)).toEqual({ count: 0, total: 0, hasSale: false });
  });

  it("soma o líquido das vendas", () => {
    expect(summarizeLeadSales([sale(1800), sale(200)])).toEqual({
      count: 2,
      total: 2000,
      hasSale: true,
    });
  });

  it("IGNORA venda cancelada — mesmo critério do dashboard", () => {
    expect(summarizeLeadSales([sale(1800), sale(500, "cancelado")])).toEqual({
      count: 1,
      total: 1800,
      hasSale: true,
    });
  });

  it("só vendas canceladas = lead sem venda", () => {
    expect(summarizeLeadSales([sale(500, "cancelado")])).toEqual({
      count: 0,
      total: 0,
      hasSale: false,
    });
  });

  it("venda em aberto conta", () => {
    expect(summarizeLeadSales([sale(1000, "aberto")]).hasSale).toBe(true);
  });
});

describe("hasSaleFilter", () => {
  it("padrão não conta como filtro ativo", () => {
    expect(hasSaleFilter(EMPTY_SALE_RANGE)).toBe(false);
  });

  it("seletor ou faixa ligam o contador", () => {
    expect(hasSaleFilter({ sale: "with", min: "", max: "" })).toBe(true);
    expect(hasSaleFilter({ sale: "all", min: "1000", max: "" })).toBe(true);
    expect(hasSaleFilter({ sale: "all", min: "", max: "5000" })).toBe(true);
  });

  it("texto que não é número não liga o contador", () => {
    expect(hasSaleFilter({ sale: "all", min: "abc", max: "" })).toBe(false);
    expect(hasSaleFilter({ sale: "all", min: "   ", max: "" })).toBe(false);
  });
});

describe("matchesSaleFilter", () => {
  const comVenda = summarizeLeadSales([sale(1800)]);
  const semVenda = summarizeLeadSales([]);

  it("sem filtro, tudo passa", () => {
    expect(matchesSaleFilter(comVenda, EMPTY_SALE_RANGE)).toBe(true);
    expect(matchesSaleFilter(semVenda, EMPTY_SALE_RANGE)).toBe(true);
  });

  it("com venda", () => {
    const filter = { sale: "with" as const, min: "", max: "" };
    expect(matchesSaleFilter(comVenda, filter)).toBe(true);
    expect(matchesSaleFilter(semVenda, filter)).toBe(false);
  });

  it("sem venda", () => {
    const filter = { sale: "without" as const, min: "", max: "" };
    expect(matchesSaleFilter(comVenda, filter)).toBe(false);
    expect(matchesSaleFilter(semVenda, filter)).toBe(true);
  });

  it("faixa de valor, limites inclusivos", () => {
    const filter = { sale: "all" as const, min: "1000", max: "2000" };
    expect(matchesSaleFilter(summarizeLeadSales([sale(1800)]), filter)).toBe(true);
    expect(matchesSaleFilter(summarizeLeadSales([sale(1000)]), filter)).toBe(true);
    expect(matchesSaleFilter(summarizeLeadSales([sale(2000)]), filter)).toBe(true);
    expect(matchesSaleFilter(summarizeLeadSales([sale(999)]), filter)).toBe(false);
    expect(matchesSaleFilter(summarizeLeadSales([sale(2001)]), filter)).toBe(false);
  });

  it("só mínimo, só máximo", () => {
    expect(
      matchesSaleFilter(comVenda, { sale: "all", min: "1000", max: "" })
    ).toBe(true);
    expect(
      matchesSaleFilter(comVenda, { sale: "all", min: "", max: "1000" })
    ).toBe(false);
  });

  it("faixa de valor exclui quem não vendeu, mesmo com o seletor em todos", () => {
    // Pedir "de 1000 a 5000" é pedir quem vendeu nessa faixa.
    expect(matchesSaleFilter(semVenda, { sale: "all", min: "1000", max: "" })).toBe(false);
  });

  it("a faixa soma as vendas do lead, não olha uma por uma", () => {
    const duas = summarizeLeadSales([sale(600), sale(600)]);
    expect(matchesSaleFilter(duas, { sale: "all", min: "1000", max: "" })).toBe(true);
  });

  it("venda cancelada não faz o lead passar em 'com venda'", () => {
    const cancelada = summarizeLeadSales([sale(5000, "cancelado")]);
    expect(matchesSaleFilter(cancelada, { sale: "with", min: "", max: "" })).toBe(false);
  });

  it("aceita vírgula como separador decimal", () => {
    expect(
      matchesSaleFilter(summarizeLeadSales([sale(1800.5)]), {
        sale: "all",
        min: "1800,5",
        max: "",
      })
    ).toBe(true);
  });
});
