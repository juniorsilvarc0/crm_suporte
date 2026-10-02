import { z } from "zod";

import type { MessageCursor } from "@/features/chat/lib/messages-page";
import { isUuid } from "@/lib/validation/uuid";

// Paginação das listas da API v1 (docs/PLANO-FASE-5.md, PR 6b): cursor opaco
// sobre `(updated_at, id)`, em ordem CRESCENTE, com os índices
// `<tabela>_updated_at_id_idx` das migrations. Keyset, não offset: linha
// alterada durante a varredura não empurra as páginas seguintes.
//
// ⚠️ `updated_at` não é monotônico: `now()` é o início da transação, e o de
// `contacts` sobe a cada mensagem. A mesma linha pode voltar numa página
// posterior (cliente deduplica por `id`), e uma transação longa pode gravar um
// `updated_at` já ultrapassado. Sincronização incremental: repetir com
// `updated_since` = maior `updated_at` visto menos uma folga.

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** O cursor é nosso: acima disso, nem se tenta decodificar. */
const MAX_CURSOR_LENGTH = 200;
const CURSOR_VERSION = "v1";

/**
 * Timestamp como o PostgREST devolve (`2026-09-29T12:34:56.123456+00:00`).
 * O cursor guarda a string CRUA: `Date` do JS só tem milissegundo, e reescrever
 * o valor faria o `eq` do desempate nunca casar com o microssegundo do banco.
 * A regex também é a barreira do `.or()`: sem vírgula, parêntese nem espaço.
 */
const DB_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2})(?::?(\d{2}))?)$/;

/** Último instante que o Postgres e o `toISOString` escrevem com ano de 4 dígitos. */
const MAX_TIMESTAMP_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/**
 * A forma não basta: "2026-02-30" ou o fuso "+99:99" passam na regex, o
 * Postgres recusa, e a lista responderia 503 "tente de novo" para uma entrada
 * que nunca vai passar. Aqui é a data que existe, com fuso até ±15:59.
 */
function isDbTimestamp(value: string): boolean {
  const match = DB_TIMESTAMP_RE.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetHour = "0", offsetMinute = "0"] = match;
  // Dia fora do mês (30/02, 00, 32) transborda para outro mês no Date.UTC.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    Number(year) >= 1 &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    Number(offsetHour) <= 15 &&
    Number(offsetMinute) <= 59
  );
}

export type Cursor = { updatedAt: string; id: string };
export type Keyed = { updated_at: string; id: string };

// O par (instante, id) com a versão na frente: cada lista tem a sua, e o
// cursor de uma não vale na outra.
function encodeKey(version: string, timestamp: string, id: string): string {
  return Buffer.from(`${version}|${timestamp}|${id}`, "utf8").toString("base64url");
}

function decodeKey(version: string, value: string): { timestamp: string; id: string } | null {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const parts = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (parts.length !== 3) return null;
  const [found, timestamp, id] = parts;
  if (found !== version || !isDbTimestamp(timestamp) || !isUuid(id)) return null;
  return { timestamp, id };
}

export function encodeCursor(row: Keyed): string {
  return encodeKey(CURSOR_VERSION, row.updated_at, row.id);
}

/** `null` quando o cursor não saiu de `encodeCursor` (ou foi adulterado). */
export function decodeCursor(value: string): Cursor | null {
  const key = decodeKey(CURSOR_VERSION, value);
  return key ? { updatedAt: key.timestamp, id: key.id } : null;
}

// Mensagens de uma conversa: `(created_at, id)`, da mais NOVA para a mais
// antiga (a mensagem não tem updated_at). O cursor é a última linha devolvida;
// a página seguinte traz as anteriores a ela.
const MESSAGE_CURSOR_VERSION = "m1";

export function encodeMessageCursor(row: { created_at: string; id: string }): string {
  return encodeKey(MESSAGE_CURSOR_VERSION, row.created_at, row.id);
}

/** `null` quando o cursor não saiu de `encodeMessageCursor` (ou é o de outra lista). */
export function decodeMessageCursor(value: string): MessageCursor | null {
  const key = decodeKey(MESSAGE_CURSOR_VERSION, value);
  return key ? { createdAt: key.timestamp, id: key.id } : null;
}

// Registros de integração: `(created_at, id)`, do mais NOVO para o mais antigo,
// como as mensagens. Versão própria, pelo mesmo motivo. É a única lista deste
// módulo que não é da API v1: serve a aba Registros da Conexão (rota de sessão).
const LOG_CURSOR_VERSION = "l1";

export function encodeLogCursor(row: { created_at: string; id: string }): string {
  return encodeKey(LOG_CURSOR_VERSION, row.created_at, row.id);
}

/** `null` quando o cursor não saiu de `encodeLogCursor` (ou é o de outra lista). */
export function decodeLogCursor(value: string): MessageCursor | null {
  const key = decodeKey(LOG_CURSOR_VERSION, value);
  return key ? { createdAt: key.timestamp, id: key.id } : null;
}

/**
 * Filtro PostgREST "depois do cursor", na mesma ordem da consulta:
 * `updated_at > ts OR (updated_at = ts AND id > id)`. Só recebe um Cursor que
 * passou por `decodeCursor`, então os valores não têm nada a escapar.
 */
export function afterCursorFilter(cursor: Cursor): string {
  return `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`;
}

/**
 * A consulta pede `limit + 1`: a linha excedente diz "tem mais" sem um
 * `count`. O próximo cursor é a última linha DEVOLVIDA.
 */
export function cursorPage<T extends Keyed>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(items[items.length - 1]) };
}

/** A query string como objeto (a última ocorrência de um nome vence). */
export function searchParamsOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/**
 * Parâmetros comuns das listas. Validados por inteiro: valor malformado é 400
 * com o campo, nunca "ignorado" (um `limit=abc` que virasse 50 esconderia o
 * erro do integrador).
 */
const INVALID_CURSOR = "Cursor inválido. Use o next_cursor da página anterior.";

/** O parâmetro `cursor`, já decodificado pela lista a que pertence. */
function cursorParam<T>(decode: (value: string) => T | null) {
  return z
    .string()
    .transform((value, ctx) => {
      const cursor = decode(value);
      if (!cursor) {
        ctx.addIssue({ code: "custom", message: INVALID_CURSOR });
        return z.NEVER;
      }
      return cursor;
    })
    .optional();
}

export const listQueryShape = {
  cursor: cursorParam(decodeCursor),
  limit: z
    .string()
    .regex(/^\d{1,3}$/, { error: `Use um número de 1 a ${MAX_PAGE_LIMIT}.` })
    .transform(Number)
    .pipe(z.number().int().min(1, { error: `Use um número de 1 a ${MAX_PAGE_LIMIT}.` }).max(MAX_PAGE_LIMIT, {
      error: `Use um número de 1 a ${MAX_PAGE_LIMIT}.`,
    }))
    .default(DEFAULT_PAGE_LIMIT),
  updated_since: z
    .iso.datetime({ offset: true, error: "Use data e hora ISO 8601 com fuso (ex.: 2026-09-29T12:00:00Z)." })
    // Em UTC: o Postgres recusa fuso acima de ±15:59, que a ISO aceita. Antes de
    // 1970 não há linha (e o ano 0000 o Postgres nem aceita); depois de 9999 o
    // toISOString escreve "+010000-…", que ele também recusa.
    .transform((value) =>
      new Date(Math.min(MAX_TIMESTAMP_MS, Math.max(0, Date.parse(value)))).toISOString()
    )
    .optional(),
  include_archived: z
    .enum(["true", "false"], { error: "Use true ou false." })
    .transform((value) => value === "true")
    .default(false),
};

/** Query de GET /conversations/{id}/messages: só o cursor (das mensagens) e o limite. */
export const messageListQuerySchema = z.strictObject({
  cursor: cursorParam(decodeMessageCursor),
  limit: listQueryShape.limit,
});
