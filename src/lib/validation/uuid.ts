// O mesmo regex das rotas (api/contracts/[id]/status, api/tags/[id]): qualquer
// versão, sem chaves nem espaços, maiúscula ou minúscula. Só os arquivos NOVOS
// importam daqui; as cópias antigas saem num refactor à parte (PROGRESS).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `unknown` porque o valor vem de params, searchParams ou corpo ainda não
// validado: número, null e array são recusados sem conversão.
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
