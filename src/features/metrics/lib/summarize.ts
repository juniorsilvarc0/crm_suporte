import type { MetricRange } from "@/features/metrics/lib/period";
import type {
  AiVsHuman,
  BreakdownRow,
  CreatedTicketRow,
  DailyPoint,
  MedianMetric,
  OpenTicketRow,
  ResolvedTicketRow,
  SupportBreakdowns,
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
  /** Os tickets em aberto agora (para os recortes); `openNow` é o `count` exato. */
  open: OpenTicketRow[];
  openNow: number;
  breachedNow: number;
  reopened: number;
};

/** Nomes por id, buscados depois da agregação (só os que aparecem). */
export type MetricNames = {
  products: Record<string, string>;
  users: Record<string, string>;
  customers: Record<string, string>;
};

export const TOP_CUSTOMERS = 10;

type Dimension = "product_id" | "customer_id" | "assigned_to_user_id";

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

type Group = { opened: number; resolved: number; openNow: number; responses: Array<number | null> };

function groupBy(input: MetricsInput, dimension: Dimension): Map<string | null, Group> {
  const groups = new Map<string | null, Group>();
  const at = (id: string | null) => {
    let group = groups.get(id);
    if (!group) {
      group = { opened: 0, resolved: 0, openNow: 0, responses: [] };
      groups.set(id, group);
    }
    return group;
  };
  for (const row of input.created) {
    const group = at(row[dimension]);
    group.opened += 1;
    if (row.first_responded_at) group.responses.push(elapsed(row.created_at, row.first_responded_at));
  }
  for (const row of input.resolved) at(row[dimension]).resolved += 1;
  for (const row of input.open) at(row[dimension]).openNow += 1;
  return groups;
}

function toRows(
  groups: Map<string | null, Group>,
  names: Record<string, string>,
  emptyLabel: string
): BreakdownRow[] {
  return [...groups].map(([id, group]) => ({
    id,
    // Id sem nome (cadastro removido entre as leituras) não some: vira "—".
    name: id ? (names[id] ?? "—") : emptyLabel,
    opened: group.opened,
    resolved: group.resolved,
    openNow: group.openNow,
    firstResponse: medianOf(group.responses),
  }));
}

/**
 * Os clientes com mais tickets abertos na janela (empate: mais em aberto
 * agora). Sem empresa não é cliente: fica fora do ranking.
 */
export function topCustomerIds(input: Pick<MetricsInput, "created" | "resolved" | "open">, limit = TOP_CUSTOMERS): string[] {
  const groups = groupBy({ ...input, createdTotal: 0, resolvedTotal: 0, openNow: 0, breachedNow: 0, reopened: 0 }, "customer_id");
  return [...groups]
    .filter((entry): entry is [string, Group] => entry[0] !== null && entry[1].opened > 0)
    .sort((a, b) => b[1].opened - a[1].opened || b[1].openNow - a[1].openNow || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

function summarizeBreakdowns(input: MetricsInput, names: MetricNames): SupportBreakdowns {
  const byName = (a: BreakdownRow, b: BreakdownRow) =>
    // "Sem …" sempre por último; o resto pelo nome, para empates não pularem.
    Number(a.id === null) - Number(b.id === null) || a.name.localeCompare(b.name, "pt-BR");

  const byProduct = toRows(groupBy(input, "product_id"), names.products, "Sem fila").sort(
    (a, b) => b.opened - a.opened || b.openNow - a.openNow || byName(a, b)
  );
  // Analista = o responsável ATUAL do ticket; a carga (em aberto) vem primeiro.
  const byAssignee = toRows(groupBy(input, "assigned_to_user_id"), names.users, "Sem responsável").sort(
    (a, b) => b.openNow - a.openNow || b.resolved - a.resolved || byName(a, b)
  );
  const top = topCustomerIds(input);
  const customerGroups = groupBy(input, "customer_id");
  const byCustomer = toRows(
    new Map(top.map((id) => [id, customerGroups.get(id) as Group])),
    names.customers,
    "Sem empresa"
  );
  const customerCount = new Set(input.created.map((row) => row.customer_id).filter(Boolean)).size;

  return { byProduct, byAssignee, byCustomer, customerCount };
}

function summarizeAiVsHuman(input: MetricsInput): AiVsHuman {
  const openedBy = { ai: 0, agent: 0, api: 0 };
  for (const row of input.created) {
    if (row.source === "ai" || row.source === "agent" || row.source === "api") openedBy[row.source] += 1;
  }
  return {
    openedBy,
    firstAiResponse: medianOf(
      input.created.map((row) => (row.first_ai_response_at ? elapsed(row.created_at, row.first_ai_response_at) : null))
    ),
    resolvedWithoutHuman: input.resolved.filter((row) => !row.first_responded_at).length,
  };
}

export function summarizeSupportMetrics(input: MetricsInput, range: MetricRange, names: MetricNames): SupportMetrics {
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
    breakdowns: summarizeBreakdowns(input, names),
    aiVsHuman: summarizeAiVsHuman(input),
    partial:
      input.createdTotal > input.created.length ||
      input.resolvedTotal > input.resolved.length ||
      input.openNow > input.open.length,
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
