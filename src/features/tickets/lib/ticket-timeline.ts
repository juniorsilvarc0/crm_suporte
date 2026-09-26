import type { TicketTimelinePage, TimelineItem, TimelineItemKind } from "@/features/tickets/types";

// Timeline do detalhe do ticket: a união de cinco fontes (status, eventos,
// comentários, mensagens do WhatsApp e anexos) numa ordem só, paginada por um
// cursor que é SÓ um instante (`before`, comparação estrita `<` no banco).
//
// Puro e neutro: a query monta as fontes, a tela pode reordenar com o mesmo
// comparador. Três regras sustentam a paginação sem perder item:
//   1. instante é o ISO cru do PostgREST, comparado com precisão de
//      MICROSSEGUNDO. `Date` corta em milissegundo, e dois itens a 1 µs um do
//      outro ficariam empatados (ou o cursor pularia um deles);
//   2. uma página nunca separa itens do mesmo instante: com o cursor `<`, a
//      metade que ficasse para trás nunca mais voltaria;
//   3. o que uma fonte deixou de trazer por bater no limite não pode ser
//      "pulado" pela página: ver buildTicketTimeline.

export const TIMELINE_PAGE_SIZE = 100;

// `2026-09-26T02:45:57.194405+00:00`: o Postgres corta os zeros da fração
// (`.1944`, ou nenhuma fração) e, fora de UTC, o fuso vem como `-03:00` (ou
// `+05:30:15`, fuso histórico). `Z` é o que o JS escreve. Sem fuso não entra: o
// mesmo texto seria outro instante em outro servidor. Mais de 6 casas também
// não: o Postgres ARREDONDA a 7ª, e o cursor viraria outro instante.
const INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::\d{2}){0,2})$/;

type ParsedInstant = { seconds: number; micros: number };

function parseInstant(value: string): ParsedInstant | null {
  const match = INSTANT_RE.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;

  // setUTCFullYear em vez de Date.UTC: este leva os anos 0–99 para 1900+.
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  // Data que "transborda" (30/02, 24:00, 12:60) volta diferente do texto.
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }

  let offsetSeconds = 0;
  if (zone !== "Z") {
    const [hours, minutes = "0", seconds = "0"] = zone.slice(1).split(":");
    if (Number(hours) > 15 || Number(minutes) > 59 || Number(seconds) > 59) return null;
    const sign = zone.startsWith("-") ? -1 : 1;
    offsetSeconds = sign * (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds));
  }

  // Segundos inteiros e microssegundos à parte: nenhum número passa de 2^53.
  return {
    seconds: date.getTime() / 1000 - offsetSeconds,
    micros: Number(fraction.padEnd(6, "0")),
  };
}

/**
 * Instante no formato que o PostgREST devolve (e que volta como `before`).
 * A rota confere o cursor com isto e responde 400 no resto.
 */
export function isTimelineInstant(value: unknown): value is string {
  return typeof value === "string" && parseInstant(value) !== null;
}

/**
 * Negativo se `a` é anterior a `b`, zero no mesmo microssegundo (mesmo com
 * frações de tamanhos diferentes ou fusos diferentes), positivo se posterior.
 *
 * Lança RangeError com instante inválido: ordenar "de qualquer jeito" poria o
 * item no lugar errado sem ninguém ver. A query confere cada instante antes.
 */
export function compareInstants(a: string, b: string): number {
  const left = parseInstant(a);
  const right = parseInstant(b);
  if (!left || !right) throw new RangeError("Instante fora do formato do PostgREST.");
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  if (left.micros !== right.micros) return left.micros < right.micros ? -1 : 1;
  return 0;
}

// No mesmo instante, a ordem cronológica é mensagem < comentário < anexo <
// status/evento (emenda 2 da Fase 4): o que alguém escreveu vem antes, e a
// trilha, que registra a reação das RPCs, por último, ordenada por `seq`.
const KIND_RANK: Record<TimelineItemKind, number> = {
  message: 0,
  comment: 1,
  attachment: 2,
  status: 3,
  event: 3,
};

/**
 * Ordem CRONOLÓGICA (negativo = `a` aconteceu antes). Status e evento
 * desempatam por `seq`, a sequência comum às duas tabelas; o resto, pelo id,
 * o mesmo desempate que a query pede ao banco (`id desc` no desc).
 */
export function compareTimelineItems(a: TimelineItem, b: TimelineItem): number {
  const byInstant = compareInstants(a.at, b.at);
  if (byInstant !== 0) return byInstant;
  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind !== 0) return byKind;
  if ((a.kind === "status" || a.kind === "event") && (b.kind === "status" || b.kind === "event")) {
    return a.seq - b.seq;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Do mais novo para o mais antigo, a ordem da tela (UI.md §5.3.1). Não muta a entrada. */
export function sortTimelineNewestFirst(items: readonly TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => compareTimelineItems(b, a));
}

/**
 * O que uma fonte trouxe para esta página. `hitLimit` = a leitura voltou com
 * exatamente o limite pedido: pode haver mais linhas no instante da mais
 * antiga que veio, e antes dele.
 */
export type TimelineSource = {
  items: readonly TimelineItem[];
  hitLimit: boolean;
};

function oldestInstant(items: readonly TimelineItem[]): string | null {
  let oldest: string | null = null;
  for (const item of items) {
    if (oldest === null || compareInstants(item.at, oldest) < 0) oldest = item.at;
  }
  return oldest;
}

/**
 * Junta as fontes e corta a página, do mais novo para o mais antigo.
 *
 * **Fonte que bateu no limite.** Cada fonte vem ordenada por instante desc e
 * cortada em N linhas. Se uma delas trouxe N, tudo o que ela tem MAIS NOVO que
 * a sua linha mais antiga veio, mas no instante dessa linha, e antes dele,
 * pode ter ficado coisa no banco. O `piso` é o mais novo desses instantes
 * entre as fontes que bateram no limite, e a página só usa itens ESTRITAMENTE
 * mais novos que o piso, de todas as fontes. Um item de outra fonte mais antigo
 * que o piso ficaria na frente de itens que a fonte cheia não trouxe, e o
 * cursor `<` os pularia para sempre; um item NO piso separaria o instante.
 * O que fica de fora volta na próxima página, lido de novo pelo cursor.
 *
 * **Corte.** Até `pageSize` itens, recuando até a fronteira de instante. Se o
 * instante mais novo sozinho passa de `pageSize`, ele vai inteiro (a página
 * fica maior, mas nunca separa um instante).
 *
 * `hasMore` é exato: há item cortado, ou alguma fonte bateu no limite (a linha
 * do piso existe e ficou para a próxima). `nextBefore` é o instante do item
 * mais antigo da página, cru, para voltar como `before`.
 *
 * Devolve `null` quando NENHUM instante veio inteiro: uma fonte trouxe o
 * limite inteiro no mesmo instante (um álbum de fotos grava todas no mesmo
 * segundo). Quem chama busca de novo essa fonte com limite maior.
 */
export function buildTicketTimeline(
  sources: readonly TimelineSource[],
  pageSize: number = TIMELINE_PAGE_SIZE
): TicketTimelinePage | null {
  let floor: string | null = null;
  for (const source of sources) {
    if (!source.hitLimit) continue;
    const oldest = oldestInstant(source.items);
    if (oldest !== null && (floor === null || compareInstants(oldest, floor) > 0)) {
      floor = oldest;
    }
  }

  const complete = sortTimelineNewestFirst(
    sources
      .flatMap((source) => source.items)
      .filter((item) => floor === null || compareInstants(item.at, floor) > 0)
  );

  if (complete.length === 0) {
    return floor === null ? { items: [], hasMore: false, nextBefore: null } : null;
  }

  const sameInstant = (i: number, j: number) =>
    compareInstants(complete[i].at, complete[j].at) === 0;

  let end = Math.min(Math.max(1, pageSize), complete.length);
  if (end < complete.length) {
    while (end > 0 && sameInstant(end, end - 1)) end -= 1;
    if (end === 0) {
      end = 1;
      while (end < complete.length && sameInstant(end, 0)) end += 1;
    }
  }

  const items = complete.slice(0, end);
  const hasMore = end < complete.length || floor !== null;
  return { items, hasMore, nextBefore: hasMore ? items[items.length - 1].at : null };
}
