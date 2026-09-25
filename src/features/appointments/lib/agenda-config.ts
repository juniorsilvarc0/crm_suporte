import type { AgendaBlock } from "@/features/appointments/lib/agenda-blocks";
import type { AppointmentModality } from "@/lib/supabase/types";

export type AppointmentType = { id: string; name: string };
export type ClinicUnit = { id: string; name: string; address: string | null };
/** Índice = dia da semana (0 = domingo). Cada posição é a lista "HH:MM". */
export type AgendaHours = string[][];

export type AgendaConfig = {
  types: AppointmentType[];
  units: ClinicUnit[];
  hours: AgendaHours;
  /** Ver `agenda-blocks.ts`: intervalos em que não há atendimento. */
  blocks: AgendaBlock[];
};

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

export const modalityOptions: { value: AppointmentModality; label: string }[] = [
  { value: "presencial", label: "Presencial" },
  { value: "teleconsulta", label: "Teleconsulta" },
];

export const modalityLabel: Record<AppointmentModality, string> = {
  presencial: "Presencial",
  teleconsulta: "Teleconsulta",
};

export const emptyAgendaHours = (): AgendaHours => [[], [], [], [], [], [], []];

export const emptyAgendaConfig = (): AgendaConfig => ({
  types: [],
  units: [],
  hours: emptyAgendaHours(),
  blocks: [],
});

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/**
 * Normaliza uma lista de horários: descarta inválido, tira repetido e ordena.
 *
 * Ordenar aqui e não na tela é o que garante que a grade gravada seja a mesma
 * que o modal oferece — dois lugares ordenando dá duas ordens.
 */
export function normalizeTimes(times: string[]): string[] {
  const seen = new Set<string>();
  for (const time of times) {
    const trimmed = time.trim();
    if (isValidTime(trimmed)) seen.add(trimmed);
  }
  return [...seen].sort();
}

/**
 * Dia da semana de "YYYY-MM-DD".
 *
 * ⚠️ Data LOCAL, montada por partes. `new Date("2026-08-07")` é interpretado
 * como UTC e, em `America/Sao_Paulo` (-03:00), volta um dia — a sexta viraria
 * quinta e a grade oferecida seria a do dia errado.
 */
export function weekdayOfDateKey(dateKey: string): number | null {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getDay();
}

/** Horários sugeridos para a data, segundo a grade configurada. */
export function timesForDateKey(hours: AgendaHours, dateKey: string): string[] {
  const weekday = weekdayOfDateKey(dateKey);
  if (weekday === null) return [];
  return hours[weekday] ?? [];
}

/**
 * O horário escolhido está fora do expediente daquele dia?
 *
 * Não bloqueia nada — é aviso. A clínica atende fora da grade quando precisa, e
 * transformar isso em erro impediria o agendamento legítimo. Ficar mudo também
 * não servia: era possível trocar a data para sexta e manter as 19:00 sem que
 * nada na tela dissesse que sexta é só de manhã.
 */
export function isOutsideAgendaHours(hours: AgendaHours, localDateTime: string): boolean {
  const dateKey = localDateTime.slice(0, 10);
  const time = localDateTime.slice(11, 16);
  if (!isValidTime(time)) return false;

  const dayTimes = timesForDateKey(hours, dateKey);
  // Dia sem grade nenhuma não gera aviso: significa "não configurado", não
  // "fechado". Alarme em todo agendamento vira ruído e ninguém lê mais.
  if (dayTimes.length === 0) return false;

  return !dayTimes.includes(time);
}
