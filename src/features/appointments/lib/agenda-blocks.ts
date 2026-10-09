import {
  APP_TIME_ZONE_OFFSET,
  addDaysToAppDateKey,
  toAppDateKey,
} from "@/lib/formatters/date";

// Bloqueios de agenda (tabela `agenda_blocks`): intervalos concretos em que a
// agenda não deve receber compromisso — férias, feriado, treinamento interno.
// De um técnico (`assignee`) ou de todos (`assignee` nulo). Recuperado da
// clínica (tag legado-clinica) e adaptado: entrou o técnico; saíram os
// horários rápidos e a compatibilidade com dados antigos de lá. Funções puras,
// testadas à parte; UI.md §5.17.

export type AgendaBlock = {
  id: string;
  /** ISO. */
  startsAt: string;
  /** ISO, exclusivo. */
  endsAt: string;
  allDay: boolean;
  reason: string | null;
  /** O técnico bloqueado; `null` = bloqueio de todos. */
  assignee: { id: string; name: string } | null;
};

export type AgendaBlockDayDescription = {
  kind: "all-day" | "partial";
  /** O motivo, com o técnico na frente quando o bloqueio é dele. */
  reason: string;
  period: string;
  label: string;
};

export const DEFAULT_BLOCK_REASON = "Indisponível";

export function blockLabel(block: Pick<AgendaBlock, "reason" | "assignee">): string {
  const reason = block.reason?.trim() || DEFAULT_BLOCK_REASON;
  return block.assignee ? `${block.assignee.name}: ${reason}` : reason;
}

/**
 * Os bloqueios que valem para um compromisso: os de todos, mais os do técnico
 * escolhido. Bloqueio de outro técnico não atrapalha.
 */
export function relevantBlocks(blocks: AgendaBlock[], assigneeId: string | null | undefined): AgendaBlock[] {
  return blocks.filter((block) => !block.assignee || block.assignee.id === assigneeId);
}

/**
 * O intervalo pedido cai dentro de algum bloqueio?
 *
 * Fim exclusivo nas duas pontas, igual ao cruzamento de compromissos: um
 * bloqueio que termina 14:00 não atrapalha a visita que começa 14:00.
 */
export function findBlocksForRange({
  blocks,
  startIso,
  durationMin,
}: {
  blocks: AgendaBlock[];
  startIso: string;
  durationMin: number;
}): AgendaBlock[] {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return [];
  const end = start + Math.max(1, durationMin) * 60_000;

  return blocks.filter((block) => {
    const blockStart = Date.parse(block.startsAt);
    const blockEnd = Date.parse(block.endsAt);
    if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return false;
    return start < blockEnd && blockStart < end;
  });
}

/** Bloqueios que tocam o dia, para desenhar a faixa na grade. */
export function blocksForDateKey(blocks: AgendaBlock[], dateKey: string): AgendaBlock[] {
  const dayStart = Date.parse(localToIso(dateKey, "00:00"));
  if (Number.isNaN(dayStart)) return [];
  const dayEnd = dayStart + 24 * 60 * 60_000;

  return blocks.filter((block) => {
    const blockStart = Date.parse(block.startsAt);
    const blockEnd = Date.parse(block.endsAt);
    if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return false;
    return dayStart < blockEnd && blockStart < dayEnd;
  });
}

/**
 * Recorte do bloqueio DENTRO do dia, em minutos desde a meia-noite.
 *
 * Um bloqueio de três dias vira uma faixa cheia em cada dia da grade, não uma
 * faixa gigante saindo pela primeira coluna.
 */
export function blockMinutesInDay(
  block: AgendaBlock,
  dateKey: string
): { startMinutes: number; endMinutes: number } | null {
  const dayStart = Date.parse(localToIso(dateKey, "00:00"));
  if (Number.isNaN(dayStart)) return null;
  const dayEnd = dayStart + 24 * 60 * 60_000;

  const blockStart = Date.parse(block.startsAt);
  const blockEnd = Date.parse(block.endsAt);
  if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return null;

  const from = Math.max(blockStart, dayStart);
  const to = Math.min(blockEnd, dayEnd);
  if (to <= from) return null;

  return {
    startMinutes: Math.round((from - dayStart) / 60_000),
    endMinutes: Math.round((to - dayStart) / 60_000),
  };
}

/** Texto e categoria visual do bloqueio dentro de um dia específico. */
export function describeAgendaBlockForDate(
  block: AgendaBlock,
  dateKey: string
): AgendaBlockDayDescription | null {
  const span = blockMinutesInDay(block, dateKey);
  if (!span) return null;

  const reason = blockLabel(block);
  const kind = block.allDay ? "all-day" : "partial";
  const period = block.allDay
    ? "Dia inteiro"
    : `${formatBlockMinute(span.startMinutes)}–${formatBlockMinute(span.endMinutes)}`;

  return { kind, reason, period, label: `${reason} · ${period}` };
}

/**
 * O período inteiro do bloqueio, para a lista do cadastro: "10/10 a 12/10" no
 * dia inteiro (o fim é exclusivo, então mostra o dia anterior), "10/10 09:00–
 * 12:00" no mesmo dia, ou as duas pontas quando atravessa dias.
 */
export function describeAgendaBlockPeriod(block: AgendaBlock): string {
  const startKey = toAppDateKey(block.startsAt);
  // Fim exclusivo: o último dia é o do instante anterior ao fim (um parcial até
  // 00:00 termina às "24:00" do dia anterior, não às 00:00 do seguinte).
  const endKey = toAppDateKey(new Date(Date.parse(block.endsAt) - 1));
  if (!startKey || !endKey) return "";

  const day = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
  if (block.allDay) {
    return startKey === endKey ? `${day(startKey)} · Dia inteiro` : `${day(startKey)} a ${day(endKey)} · Dia inteiro`;
  }

  const startSpan = blockMinutesInDay(block, startKey);
  const endSpan = blockMinutesInDay(block, endKey);
  const startTime = startSpan ? formatBlockMinute(startSpan.startMinutes) : "";
  const endTime = endSpan ? formatBlockMinute(endSpan.endMinutes) : "";
  return startKey === endKey
    ? `${day(startKey)} ${startTime}–${endTime}`
    : `${day(startKey)} ${startTime} a ${day(endKey)} ${endTime}`;
}

function formatBlockMinute(minutes: number): string {
  const bounded = Math.min(24 * 60, Math.max(0, Math.round(minutes)));
  const hour = Math.floor(bounded / 60);
  const minute = bounded % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * "AAAA-MM-DD" + "HH:MM" → ISO, no fuso do app.
 *
 * ⚠️ Data LOCAL montada por partes, nunca `new Date("2026-08-07T09:00Z")`: o app
 * trabalha em `America/Sao_Paulo`, e ler como UTC deslocaria três horas.
 */
export function localToIso(dateKey: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) {
    return "";
  }
  const instant = new Date(`${dateKey}T${time}:00${APP_TIME_ZONE_OFFSET}`);
  return Number.isNaN(instant.getTime()) ? "" : instant.toISOString();
}

/** Dias (chave "AAAA-MM-DD") tocados pelo bloqueio, para marcar no calendário. */
export function blockDateKeys(block: AgendaBlock, limit = 90): string[] {
  const start = Date.parse(block.startsAt);
  const end = Date.parse(block.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return [];

  const firstKey = toAppDateKey(block.startsAt);
  // O fim é exclusivo. Um bloqueio até 08/08 00:00 termina no dia 07.
  const lastKey = toAppDateKey(new Date(end - 1));
  if (!firstKey || !lastKey) return [];

  const keys: string[] = [];
  let cursor = firstKey;
  for (let index = 0; index < limit && cursor <= lastKey; index += 1) {
    keys.push(cursor);
    cursor = addDaysToAppDateKey(cursor, 1);
  }
  return keys;
}
