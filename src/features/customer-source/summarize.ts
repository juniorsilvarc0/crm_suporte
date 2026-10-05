import type { CustomerContext } from "./types";

// Resumo do contexto para a tela: o que o atendente lê de relance. Lógica pura
// (sem formatação de moeda/data, que é da tela), para testar sem renderizar.
export type CustomerContextSummary = {
  situacao: string | null;
  /** Quantos contratos o cliente tem. */
  contratoCount: number;
  /** O estado do contrato quando há exatamente um (vigência, ou status). */
  contratoStatus: string | null;
  quantidadeEmAberto: number;
  /** Soma de principal + multa + juros dos títulos em aberto. */
  totalEmAberto: number;
  /** O vencimento mais próximo entre os títulos em aberto, ou null. */
  proximoVencimento: string | null;
};

export function summarizeCustomerContext(context: CustomerContext): CustomerContextSummary {
  const open = context.titulosEmAberto;
  const totalEmAberto = open.reduce(
    (sum, invoice) => sum + (invoice.valorPrincipal ?? 0) + (invoice.multaValor ?? 0) + (invoice.jurosValor ?? 0),
    0
  );
  const proximoVencimento =
    open
      .map((invoice) => invoice.dataVencimento)
      .filter((date): date is string => Boolean(date))
      .sort()[0] ?? null;
  const single = context.contratos.length === 1 ? context.contratos[0] : null;

  return {
    situacao: context.status,
    contratoCount: context.contratos.length,
    contratoStatus: single ? (single.statusVigencia ?? single.status) : null,
    quantidadeEmAberto: open.length,
    totalEmAberto,
    proximoVencimento,
  };
}
