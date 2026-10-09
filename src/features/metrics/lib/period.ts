import { APP_TIME_ZONE_OFFSET, addDaysToAppDateKey } from "@/lib/formatters/date";

// O período das métricas vive na URL (`?periodo=7|30|90`, em dias). "Últimos N
// dias" = de 00:00 do dia (hoje - N + 1) até 00:00 de amanhã, no fuso do app:
// hoje entra inteiro, e cada dia do gráfico é um dia do calendário de São Paulo.
// Sem "todo o período": uma janela sem fim faria a consulta crescer para sempre.

export const METRIC_PERIODS = [7, 30, 90] as const;

export type MetricPeriod = (typeof METRIC_PERIODS)[number];

export const DEFAULT_METRIC_PERIOD: MetricPeriod = 30;

export type MetricRange = {
  days: MetricPeriod;
  startIso: string;
  endIso: string;
  /** AAAA-MM-DD de cada dia da janela, do mais antigo ao de hoje. */
  dayKeys: string[];
};

type SearchParams = Record<string, string | string[] | undefined>;

export function parseMetricPeriod(searchParams: SearchParams): MetricPeriod {
  const raw = searchParams.periodo;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return METRIC_PERIODS.find((days) => days === value) ?? DEFAULT_METRIC_PERIOD;
}

export function metricRange(days: MetricPeriod, todayKey: string): MetricRange {
  const firstKey = addDaysToAppDateKey(todayKey, -(days - 1));
  const dayKeys = Array.from({ length: days }, (_, index) => addDaysToAppDateKey(firstKey, index));
  return {
    days,
    startIso: `${firstKey}T00:00:00${APP_TIME_ZONE_OFFSET}`,
    endIso: `${addDaysToAppDateKey(todayKey, 1)}T00:00:00${APP_TIME_ZONE_OFFSET}`,
    dayKeys,
  };
}

export function metricPeriodHref(days: MetricPeriod): string {
  return days === DEFAULT_METRIC_PERIOD ? "/app/metricas" : `/app/metricas?periodo=${days}`;
}
