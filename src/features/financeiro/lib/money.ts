// Aritmética de dinheiro da venda, em CENTAVOS INTEIROS.
//
// Motivo: `numeric(12,2)` no banco, mas JavaScript faz conta em ponto
// flutuante. Dividir R$ 100 em 3× arredondando cada parcela dá 99,99 — e o
// contrato nunca fecha. Toda conta aqui é feita em inteiro e só volta para
// reais na borda. Mesma escolha já feita em recompute-contract-status.ts.
//
// Puro e sem Supabase, no molde de features/deals/lib/attendance.ts.

/** Reais → centavos. `Math.round` mata o erro de ponto flutuante (19.9 * 100 = 1989.9999…). */
export function toCents(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** Centavos → reais, com 2 casas exatas. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Valor líquido da venda. Desconto maior que o total não gera negativo. */
export function netAmountCents(totalCents: number, discountCents: number): number {
  return Math.max(0, totalCents - discountCents);
}
