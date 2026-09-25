// Paginação do histórico de uma conversa.
//
// A janela é buscada com `created_at desc, id desc` e revertida para exibir.
// Para pegar a página anterior usamos **keyset** (cursor na última linha), não
// `offset`: mensagem nova chegando durante a navegação empurra o offset e faz
// linha repetir ou sumir. Com cursor, o ponto de corte é a própria linha.
//
// `created_at` não é único (webhook em lote grava várias no mesmo instante), daí
// o desempate por `id`.

export const MESSAGES_PAGE_SIZE = 100;

export type MessageCursor = { createdAt: string; id: string };

/**
 * Filtro PostgREST para "mais antigas que o cursor", respeitando a mesma ordem
 * da consulta: `created_at < ts OR (created_at = ts AND id < id)`.
 */
export function olderThanFilter(cursor: MessageCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

/**
 * Filtro para "mais NOVAS que o cursor" — a metade de baixo da janela ao redor
 * de uma mensagem, usada pelo pulo da busca. Espelha `olderThanFilter`.
 */
export function newerThanFilter(cursor: MessageCursor): string {
  return `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`;
}

/** Quantas mensagens de contexto acompanham o resultado da busca, de cada lado. */
export const AROUND_CONTEXT = 30;

export type Pageable = { id: string; created_at: string };

/**
 * Corta a página e diz se ainda há mais.
 *
 * A consulta pede `limit + 1` de propósito: a linha excedente responde
 * "tem mais?" sem um `count` separado, que numa tabela de 7 mil linhas custaria
 * uma varredura a cada clique.
 */
export function takePage<T>(rows: T[], limit: number): { page: T[]; hasMore: boolean } {
  const hasMore = rows.length > limit;
  return { page: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/** Cursor da mensagem mais ANTIGA já carregada — o ponto de partida da próxima página. */
export function oldestCursor(messages: Pageable[]): MessageCursor | null {
  const oldest = messages[0];
  return oldest ? { createdAt: oldest.created_at, id: oldest.id } : null;
}

/**
 * Junta a página antiga com o que já está na tela, sem duplicar.
 *
 * Realtime pode ter inserido no meio do caminho uma mensagem que também vem na
 * página; sem a checagem por id, ela apareceria duas vezes.
 */
export function prependOlder<T extends Pageable>(older: T[], current: T[]): T[] {
  if (older.length === 0) return current;
  const known = new Set(current.map((message) => message.id));
  const novos = older.filter((message) => !known.has(message.id));
  return novos.length > 0 ? [...novos, ...current] : current;
}
