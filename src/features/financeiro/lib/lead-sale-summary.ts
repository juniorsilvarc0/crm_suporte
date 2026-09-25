import type { LeadSale } from "@/features/financeiro/types";

// Resumo de venda por lead, usado pelo card do funil, pela tabela de leads e
// pelos filtros das duas telas. Puro e sem Supabase, no molde de
// features/deals/lib/attendance.ts.

export type LeadSaleSummary = {
  /** Quantas vendas válidas o lead tem. */
  count: number;
  /** Soma do líquido das vendas válidas. */
  total: number;
  hasSale: boolean;
};

export const EMPTY_SALE_SUMMARY: LeadSaleSummary = {
  count: 0,
  total: 0,
  hasSale: false,
};

/**
 * Venda cancelada não conta — é o mesmo critério do dashboard, que filtra
 * `status !== 'cancelado'` antes de somar receita. Se contasse aqui, o card
 * mostraria dinheiro que o dashboard não mostra.
 */
export function summarizeLeadSales(sales: LeadSale[] | undefined): LeadSaleSummary {
  const valid = (sales ?? []).filter((sale) => sale.status !== "cancelado");
  if (valid.length === 0) return EMPTY_SALE_SUMMARY;

  return {
    count: valid.length,
    total: valid.reduce((sum, sale) => sum + sale.netAmount, 0),
    hasSale: true,
  };
}

export type SaleFilter = "all" | "with" | "without";

export type SaleRangeFilter = {
  sale: SaleFilter;
  /** Vazio = sem limite. */
  min: string;
  max: string;
};

export const EMPTY_SALE_RANGE: SaleRangeFilter = { sale: "all", min: "", max: "" };

function toBound(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Algum filtro de venda está ativo? Serve para o contador de filtros da toolbar. */
export function hasSaleFilter(filter: SaleRangeFilter): boolean {
  return (
    filter.sale !== "all" || toBound(filter.min) !== null || toBound(filter.max) !== null
  );
}

/**
 * Decide se um lead passa no filtro de venda.
 *
 * A faixa de valor só se aplica a quem tem venda: pedir "de R$ 1.000 a R$ 5.000"
 * é pedir quem vendeu nessa faixa, então quem não vendeu sai — mesmo com o
 * seletor em "todos". Sem essa regra a faixa não filtraria nada.
 */
export function matchesSaleFilter(
  summary: LeadSaleSummary,
  filter: SaleRangeFilter
): boolean {
  if (filter.sale === "with" && !summary.hasSale) return false;
  if (filter.sale === "without" && summary.hasSale) return false;

  const min = toBound(filter.min);
  const max = toBound(filter.max);
  if (min === null && max === null) return true;

  if (!summary.hasSale) return false;
  if (min !== null && summary.total < min) return false;
  if (max !== null && summary.total > max) return false;
  return true;
}
