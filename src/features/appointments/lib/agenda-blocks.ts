import {
  APP_TIME_ZONE_OFFSET,
  addDaysToAppDateKey,
  toAppDateKey,
} from "@/lib/formatters/date";

export type AgendaBlock = {
  id: string;
  /** ISO. */
  startsAt: string;
  /** ISO, exclusivo. */
  endsAt: string;
  allDay: boolean;
  reason: string | null;
};

export type AgendaBlockDayDescription = {
  kind: "all-day" | "partial";
  reason: string;
  period: string;
  label: string;
};

/**
 * Motivos sugeridos.
 *
 * Presets existem para o caso comum sair em um clique, mas o campo continua
 * texto livre: uma lista fechada obrigaria a mexer no código toda vez que
 * aparecer um motivo novo, que é justamente o erro que a grade de horários
 * fixa cometia.
 */
export const BLOCK_REASON_PRESETS = [
  "Férias",
  "Feriado",
  "Congresso",
  "Cirurgia",
  "Almoço",
  "Compromisso pessoal",
] as const;

export const DEFAULT_BLOCK_REASON = "Indisponível";

export function blockLabel(block: AgendaBlock): string {
  const reason = block.reason?.trim();
  return reason && reason.length > 0 ? reason : DEFAULT_BLOCK_REASON;
}

/**
 * O intervalo pedido cai dentro de algum bloqueio?
 *
 * Fim exclusivo nas duas pontas, igual ao cruzamento de agendamentos: um
 * bloqueio que termina 14:00 não atrapalha a consulta que começa 14:00.
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

/**
 * Um horário pontual ("HH:MM" de um dia) está bloqueado?
 *
 * Usado para apagar os atalhos de horário rápido que não valem mais. Aqui o
 * instante é tratado como um ponto, não como uma consulta de uma hora: o que
 * interessa é se aquele começo está dentro de um bloqueio.
 */
export function isTimeBlocked({
  blocks,
  dateKey,
  time,
}: {
  blocks: AgendaBlock[];
  dateKey: string;
  time: string;
}): AgendaBlock | null {
  const instant = Date.parse(localToIso(dateKey, time));
  if (Number.isNaN(instant)) return null;

  return (
    blocks.find((block) => {
      const blockStart = Date.parse(block.startsAt);
      const blockEnd = Date.parse(block.endsAt);
      if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return false;
      return instant >= blockStart && instant < blockEnd;
    }) ?? null
  );
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
 * Um bloqueio de três dias precisa virar uma faixa cheia em cada dia da grade,
 * não uma faixa gigante saindo pela primeira coluna. Por isso o corte acontece
 * aqui e não no componente.
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

  return {
    kind,
    reason,
    period,
    label: `${reason} · ${period}`,
  };
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
 * ⚠️ Data LOCAL montada por partes, nunca `new Date("2026-08-07T09:00Z")`. O app
 * inteiro trabalha em `America/Sao_Paulo`; interpretar como UTC deslocaria três
 * horas e o bloqueio da manhã passaria a valer de madrugada.
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

/**
 * Compatibilidade com bloqueios de dia inteiro criados antes da correção.
 *
 * A rota antiga usava o fuso do processo. No container UTC, a data escolhida
 * virava `00:00Z`, isto é, 21h da véspera no CRM. Um dia inteiro válido do app
 * nasce às `03:00Z`; portanto meia-noite UTC identifica sem ambiguidade o
 * formato legado e pode ser reinterpretada pela própria data UTC escolhida.
 */
export function normalizeAgendaBlock(block: AgendaBlock): AgendaBlock {
  if (!block.allDay) return block;

  const startsAt = normalizeLegacyAllDayInstant(block.startsAt);
  const endsAt = normalizeLegacyAllDayInstant(block.endsAt);
  if (startsAt === block.startsAt && endsAt === block.endsAt) return block;
  return { ...block, startsAt, endsAt };
}

function normalizeLegacyAllDayInstant(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  if (
    instant.getUTCHours() !== 0 ||
    instant.getUTCMinutes() !== 0 ||
    instant.getUTCSeconds() !== 0 ||
    instant.getUTCMilliseconds() !== 0
  ) {
    return value;
  }

  const pad = (part: number) => String(part).padStart(2, "0");
  const dateKey = `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`;
  return localToIso(dateKey, "00:00") || value;
}
