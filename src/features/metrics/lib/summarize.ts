import type { MetricRange } from "@/features/metrics/lib/period";
import type {
  CreatedTicketRow,
  DailyPoint,
  MedianMetric,
  ResolvedTicketRow,
  SupportMetrics,
} from "@/features/metrics/types";
import { toAppDateKey } from "@/lib/formatters/date";

// Agregação pura das métricas de suporte (UI.md §1.5: o número vem do banco;
// aqui só se conta e se tira mediana do que a consulta trouxe). Testada à parte.

export type MetricsInput = {
  created: CreatedTicketRow[];
  /** `count` exato dos abertos na janela (pode passar das linhas lidas). */
  createdTotal: number;
  resolved: ResolvedTicketRow[];
  resolvedTotal: number;
  openNow: number;
  breachedNow: number;
  reopened: number;
};

/** Mediana; `null` sem amostra. Par = média dos dois do meio. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function elapsed(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // Resposta entregue antes da abertura conta na abertura (PRD §7.3): zero, nunca negativo.
  return Math.max(0, end - start);
}

function medianOf(samples: Array<number | null>): MedianMetric {
  const values = samples.filter((value): value is number => value !== null);
  return { medianMs: median(values), sample: values.length };
}

export function summarizeSupportMetrics(input: MetricsInput, range: MetricRange): SupportMetrics {
  const daily = new Map<string, DailyPoint>(
    range.dayKeys.map((date) => [date, { date, abertos: 0, resolvidos: 0 }])
  );
  for (const row of input.created) {
    const point = daily.get(toAppDateKey(row.created_at));
    if (point) point.abertos += 1;
  }
  for (const row of input.resolved) {
    const point = daily.get(toAppDateKey(row.resolved_at));
    if (point) point.resolvidos += 1;
  }

  return {
    openNow: input.openNow,
    breachedNow: input.breachedNow,
    opened: input.createdTotal,
    openedByAi: input.created.filter((row) => row.source === "ai").length,
    resolved: input.resolvedTotal,
    firstResponse: medianOf(
      input.created.map((row) => (row.first_responded_at ? elapsed(row.created_at, row.first_responded_at) : null))
    ),
    resolution: medianOf(input.resolved.map((row) => elapsed(row.created_at, row.resolved_at))),
    reopened: input.reopened,
    daily: [...daily.values()],
    partial: input.createdTotal > input.created.length || input.resolvedTotal > input.resolved.length,
  };
}

/**
 * Duração de uma métrica: "menos de 1 min", "45 min", "2 h 15 min", "3 d 4 h".
 * Arredonda ao minuto (ou à hora, acima de um dia). Diferente do
 * `formatDuration` do SLA, que arredonda para baixo na unidade inteira ("2
 * horas" para 2 h 59 min): numa mediana, os minutos importam.
 */
export function formatMetricDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return "menos de 1 min";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const hours = Math.round(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}
