const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Moeda em Real, sem centavos (ex.: R$ 35.613).
export function formatMoney(value: number | null | undefined): string {
  return brl.format(Number(value ?? 0));
}

const brlExact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Moeda COM centavos (ex.: R$ 1.850,50).
//
// `formatMoney` arredonda de propósito — é para KPI, card do funil e eixo de
// gráfico, onde centavo é ruído. Registro financeiro é outra coisa: parcelar
// R$ 1.000 em 3× gera 333,34, e mostrar "R$ 333" seria mentira. Use esta nas
// telas de venda e de pagamento.
export function formatMoneyExact(value: number | null | undefined): string {
  return brlExact.format(Number(value ?? 0));
}

// Versão compacta para eixos de gráfico (ex.: R$ 8 mil).
export function formatMoneyCompact(value: number | null | undefined): string {
  return brlCompact.format(Number(value ?? 0));
}
