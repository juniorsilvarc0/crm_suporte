// Concorrência otimista da API v1 (decisão D7 do docs/PLANO-FASE-5.md): o ETag
// de um ticket é `W/"<version>"`, e toda escrita que altera um ticket existente
// (PATCH, transitions, assign) exige `If-Match` com ele. Sem o header, 428; com
// uma versão velha, 412 (a RPC compara a versão dentro da transação).

export const IF_MATCH_HEADER = "If-Match";
export const ETAG_HEADER = "ETag";

/** Teto do integer do Postgres: acima disso a RPC responderia 22003. */
const MAX_VERSION = 2147483647;

export function etagFor(version: number): string {
  return `W/"${version}"`;
}

export type IfMatch = { ok: true; version: number } | { ok: false; reason: "missing" | "invalid" };

/**
 * Lê a versão do If-Match. Aceita `W/"3"` e `"3"` (fraco ou forte: é o mesmo
 * número). Recusa `*`, lista de ETags e qualquer outra coisa: a escrita
 * precisa de UMA versão lida antes.
 */
export function parseIfMatch(request: Request): IfMatch {
  const header = request.headers.get(IF_MATCH_HEADER);
  if (header === null || header.trim() === "") return { ok: false, reason: "missing" };
  const match = /^(?:W\/)?"([1-9]\d{0,9})"$/.exec(header.trim());
  if (!match) return { ok: false, reason: "invalid" };
  const version = Number(match[1]);
  return version <= MAX_VERSION ? { ok: true, version } : { ok: false, reason: "invalid" };
}
