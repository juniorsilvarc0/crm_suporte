// Em qual card do lead a venda cai, quando ela não nasceu no funil.
//
// A lista de leads não carrega `deals`, então "Registrar venda" de lá manda só
// o `lead_id`. Sem escolher um card, `register_sale` não move nada e a venda
// ficaria registrada com o lead parado em "Em atendimento" — enquanto a mesma
// venda feita pelo funil moveria. Duas telas, dois resultados.
//
// Puro e sem Supabase para ser testável, no molde de deals/lib/lead-status.ts.

export type DealForSale = {
  id: string;
  stage: string | null;
  created_at: string;
};

export type SaleStageColumn = {
  key: string;
  position: number;
  stage_type: string | null;
};

/**
 * Regra, nesta ordem:
 *
 * 1. O card ABERTO mais avançado do board. É o atendimento vivo — o que a
 *    pessoa moveria à mão depois de vender.
 * 2. Não há nenhum aberto? O card mais recente. O lead já é cliente e está
 *    comprando de novo; a venda acompanha a última negociação.
 * 3. Sem card, devolve null: a venda é registrada e o funil não é tocado.
 *
 * Empate de posição resolve pelo mais recente, para a escolha ser estável.
 */
export function pickSaleDeal(
  deals: DealForSale[],
  columns: SaleStageColumn[]
): string | null {
  if (deals.length === 0) return null;

  const positionOf = new Map(columns.map((column) => [column.key, column.position]));
  const closed = new Set(
    columns
      .filter((column) => column.stage_type === "won" || column.stage_type === "lost")
      .map((column) => column.key)
  );

  const newest = (a: DealForSale, b: DealForSale) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

  const open = deals.filter((deal) => !deal.stage || !closed.has(deal.stage));
  if (open.length > 0) {
    const ranked = [...open].sort((a, b) => {
      const byPosition =
        (b.stage ? (positionOf.get(b.stage) ?? -1) : -1) -
        (a.stage ? (positionOf.get(a.stage) ?? -1) : -1);
      return byPosition !== 0 ? byPosition : newest(a, b);
    });
    return ranked[0]?.id ?? null;
  }

  return [...deals].sort(newest)[0]?.id ?? null;
}
