// O mesmo regex das rotas (api/contracts/[id]/status, api/tags/[id]): qualquer
// versão, sem chaves nem espaços, maiúscula ou minúscula. Só os arquivos NOVOS
// importam daqui; as cópias antigas saem num refactor à parte (PROGRESS).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `unknown` porque o valor vem de params, searchParams ou corpo ainda não
// validado: número, null e array são recusados sem conversão.
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// UUID v4 gerado no navegador. `crypto.randomUUID` só existe em contexto seguro
// (https ou localhost): aberto por http:// num IP da rede local ele some, e quem
// o chamasse direto caía ao montar. `getRandomValues` não tem essa exigência.
export function newUuid(): string {
  const native = globalThis.crypto.randomUUID?.();
  if (native) return native;

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  // Versão 4 no nibble alto do byte 6; variante RFC 4122 (10xx) no byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
