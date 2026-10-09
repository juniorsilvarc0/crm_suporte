import type { AppointmentListItem } from "@/features/appointments/types";
import {
  APP_TIME_ZONE_OFFSET,
  addDaysToAppDateKey,
  addMonthsToAppMonthKey,
  dateKeyToAppDate,
  formatDayNumber,
  formatLongDate,
  formatMonthShort,
  formatMonthTitle,
  formatTime,
  getDayQueryRange,
  getMonthQueryRange,
  getWeekDateKeys,
  getWeekQueryRange,
  normalizeAppMonthKey,
  toAppDateKey,
} from "@/lib/formatters/date";

// O período da Agenda vive na URL: `?view=mes|semana|dia|lista`, mais `month`
// (mês e lista) ou `date` (semana e dia). Funções puras, testadas à parte; a
// página (servidor) e a faixa de controles (cliente) usam as mesmas.

export const AGENDA_VIEWS = ["mes", "semana", "dia", "lista"] as const;

export type AgendaView = (typeof AGENDA_VIEWS)[number];

export type AgendaPeriod = {
  view: AgendaView;
  /** AAAA-MM: o mês de "mes" e "lista". */
  monthKey: string;
  /** AAAA-MM-DD: o dia de "semana" e "dia". */
  dateKey: string;
};

export const agendaViewLabel: Record<AgendaView, string> = {
  mes: "Mês",
  semana: "Semana",
  dia: "Dia",
  lista: "Lista",
};

export const WEEK_DAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"] as const;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isAgendaView(value: unknown): value is AgendaView {
  return AGENDA_VIEWS.some((view) => view === value);
}

/** Dia válido de verdade: "2026-02-31" não passa (a volta não bate). */
function isValidDateKey(value: string | undefined): value is string {
  if (!value || !DATE_KEY_RE.test(value)) return false;
  return toAppDateKey(dateKeyToAppDate(value)) === value;
}

/**
 * Lê o período da URL. Valor estranho vira o padrão (mês corrente), não erro:
 * link velho ou editado à mão abre a agenda de hoje.
 *
 * Sem `date`, o dia é o 1º do mês pedido (ou hoje, no mês corrente): é ele que
 * a semana e o dia usam ao trocar de visão a partir do mês.
 */
export function parseAgendaParams(searchParams: SearchParams, todayKey: string): AgendaPeriod {
  const rawView = firstParam(searchParams.view);
  const rawMonth = firstParam(searchParams.month);
  const rawDate = firstParam(searchParams.date);

  const view = isAgendaView(rawView) ? rawView : "mes";
  const currentMonth = todayKey.slice(0, 7);
  const validDate = isValidDateKey(rawDate) ? rawDate : null;
  const monthKey = rawMonth ? normalizeAppMonthKey(rawMonth) : (validDate?.slice(0, 7) ?? currentMonth);
  const dateKey = validDate ?? (monthKey !== currentMonth ? `${monthKey}-01` : todayKey);

  return { view, monthKey: view === "semana" || view === "dia" ? dateKey.slice(0, 7) : monthKey, dateKey };
}

/**
 * O intervalo da consulta, em ISO com o fuso do app. O mês pega a grade
 * inteira (os dias do mês vizinho que aparecem nas pontas); a lista, só o mês.
 */
export function agendaRange(period: AgendaPeriod): { startIso: string; endIso: string } {
  switch (period.view) {
    case "semana":
      return getWeekQueryRange(period.dateKey);
    case "dia":
      return getDayQueryRange(period.dateKey);
    case "lista":
      return {
        startIso: `${period.monthKey}-01T00:00:00${APP_TIME_ZONE_OFFSET}`,
        endIso: `${addMonthsToAppMonthKey(period.monthKey, 1)}-01T00:00:00${APP_TIME_ZONE_OFFSET}`,
      };
    default:
      return getMonthQueryRange(period.monthKey);
  }
}

/** URL da agenda numa visão e período. Semana e dia levam `date`; o resto, `month`. */
export function agendaHref(view: AgendaView, key: { monthKey?: string; dateKey?: string }): string {
  const params = new URLSearchParams({ view });
  if ((view === "semana" || view === "dia") && key.dateKey) params.set("date", key.dateKey);
  else if (key.monthKey) params.set("month", key.monthKey);
  return `/app/agendamentos?${params.toString()}`;
}

/** Os links de "Hoje", anterior e próximo, na visão atual. */
export function agendaStepHrefs(period: AgendaPeriod, todayKey: string) {
  const { view, monthKey, dateKey } = period;
  if (view === "semana" || view === "dia") {
    const step = view === "semana" ? 7 : 1;
    return {
      today: agendaHref(view, { dateKey: todayKey }),
      previous: agendaHref(view, { dateKey: addDaysToAppDateKey(dateKey, -step) }),
      next: agendaHref(view, { dateKey: addDaysToAppDateKey(dateKey, step) }),
    };
  }
  return {
    today: agendaHref(view, { monthKey: todayKey.slice(0, 7) }),
    previous: agendaHref(view, { monthKey: addMonthsToAppMonthKey(monthKey, -1) }),
    next: agendaHref(view, { monthKey: addMonthsToAppMonthKey(monthKey, 1) }),
  };
}

/** O link de cada aba, mantendo o período: do mês para a semana vai o dia, e vice-versa. */
export function agendaViewHref(target: AgendaView, period: AgendaPeriod): string {
  return target === "semana" || target === "dia"
    ? agendaHref(target, { dateKey: period.dateKey })
    : agendaHref(target, { monthKey: period.monthKey });
}

export function capitalizeFirst(value: string): string {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

/** O título da faixa: "Outubro de 2026", "4–10 de out." ou "Sexta-feira, 9 de outubro de 2026". */
export function agendaTitle(period: AgendaPeriod): string {
  if (period.view === "dia") return capitalizeFirst(formatLongDate(dateKeyToAppDate(period.dateKey)));
  if (period.view === "semana") {
    const keys = getWeekDateKeys(period.dateKey);
    if (keys.length < 7) return "";
    return `${formatDayNumber(keys[0])}–${formatDayNumber(keys[6])} de ${formatMonthShort(keys[6])}`;
  }
  return capitalizeFirst(formatMonthTitle(period.monthKey));
}

/** Os compromissos por dia (AAAA-MM-DD no fuso do app), na ordem em que chegaram. */
export function groupAppointmentsByDay(
  appointments: AppointmentListItem[],
  dayKeys: ReadonlyArray<string>
): Map<string, AppointmentListItem[]> {
  const byDay = new Map<string, AppointmentListItem[]>(dayKeys.map((key) => [key, []]));
  for (const appointment of appointments) {
    byDay.get(toAppDateKey(appointment.scheduled_at))?.push(appointment);
  }
  return byDay;
}

/** Minutos desde a meia-noite, lidos no fuso do app (nunca `getHours()`). */
export function startMinutesOf(scheduledAt: string): number {
  const [hour, minute] = formatTime(scheduledAt).split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

/** "HH:MM" do horário de começo e de fim (com a duração), no fuso do app. */
export function appointmentTimeRange(appointment: Pick<AppointmentListItem, "scheduled_at" | "duration_min">): string {
  const start = formatTime(appointment.scheduled_at);
  if (!appointment.duration_min) return start;
  const end = new Date(new Date(appointment.scheduled_at).getTime() + appointment.duration_min * 60_000);
  return `${start}–${formatTime(end.toISOString())}`;
}
