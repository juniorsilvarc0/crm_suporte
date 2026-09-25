import type { PeriodFilter } from "@/features/dashboard/types";
import type { Lead } from "@/features/leads/types";

// Extrai o período (?period=) dos searchParams da página.
export function getPeriodFromSearchParams(
  params: Record<string, string | string[] | undefined>
): string | undefined {
  const value = params.period;
  return Array.isArray(value) ? value[0] : value;
}

export type DateRange = { from: Date; to: Date };

// Rótulo amigável do período (para subtítulos "vs período anterior").
const PERIOD_LABEL: Record<string, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
};

// Intervalo atual + intervalo imediatamente anterior (mesma duração), para
// calcular variação %. "all"/ausente → current null (base inteira, sem comparação).
export function getPeriodRange(period?: string): {
  current: DateRange | null;
  previous: DateRange | null;
  days: number | null;
  label: string;
} {
  if (!period || period === "all") {
    return { current: null, previous: null, days: null, label: "todo o período" };
  }

  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - days);

  return {
    current: { from, to },
    previous: { from: prevFrom, to: from },
    days,
    label: PERIOD_LABEL[period] ?? `${days} dias`,
  };
}

// Converte o período selecionado em um intervalo (a partir de "from"). "all" ou
// ausência de período = sem filtro (base inteira).
export function getPeriodFilter(period?: string): PeriodFilter {
  if (!period || period === "all") {
    return {};
  }

  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const from = new Date();
  from.setDate(from.getDate() - days);

  return { from: from.toISOString() };
}

// Filtra leads pelo created_at dentro do intervalo do período.
export function filterLeadsByPeriod(leads: Lead[], period: PeriodFilter): Lead[] {
  if (!period.from && !period.to) {
    return leads;
  }

  const fromTime = period.from ? new Date(period.from).getTime() : null;
  const toTime = period.to ? new Date(period.to).getTime() : null;

  return leads.filter((lead) => {
    const created = new Date(lead.created_at).getTime();
    if (fromTime !== null && created < fromTime) return false;
    if (toTime !== null && created > toTime) return false;
    return true;
  });
}
