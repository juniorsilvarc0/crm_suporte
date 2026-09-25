// Qual coluna `*_at` do lead cada etapa canônica carimba.
//
// Extraído de /api/leads/[id]/status para virar fonte única: a rota de venda
// também move o lead para a etapa de ganho, e a versão antiga dela carimbava
// `cliente_at` SEMPRE — inclusive quando a etapa de ganho era uma coluna
// customizada do board. Duas regras para a mesma decisão davam dados
// diferentes conforme o caminho usado.
//
// Colunas customizadas do funil não carimbam nada: `qualificado_at`,
// `agendado_at`, `compareceu_at` e `cliente_at` são marcos do funil canônico e
// alimentam métricas do dashboard (avgConversionDays, coortes do rastreamento).

export const STATUS_TIMESTAMP_COLUMN: Record<string, string> = {
  qualificado: "qualificado_at",
  agendado: "agendado_at",
  compareceu: "compareceu_at",
  cliente: "cliente_at",
};

/** Coluna a carimbar para a etapa, ou null quando a etapa não é canônica. */
export function statusTimestampColumn(status: string | null | undefined): string | null {
  if (!status) return null;
  return STATUS_TIMESTAMP_COLUMN[status] ?? null;
}

/** `cliente_at` só quando a etapa de ganho é a canônica `cliente`. */
export function shouldStampClienteAt(status: string | null | undefined): boolean {
  return statusTimestampColumn(status) === "cliente_at";
}
