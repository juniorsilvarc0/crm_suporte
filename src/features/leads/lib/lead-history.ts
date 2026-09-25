import { getLeadStatusLabel } from "@/features/leads/schemas/status";
import { formatDate, formatTime } from "@/lib/formatters/date";
import type { Database } from "@/lib/supabase/types";

type StageHistoryRow = Pick<
  Database["public"]["Tables"]["deal_stage_history"]["Row"],
  "id" | "from_stage" | "to_stage" | "occurred_at"
>;

type BoardColumnLabel = Pick<
  Database["public"]["Tables"]["board_columns"]["Row"],
  "key" | "label"
>;

export type LeadHistoryItem = {
  id: string;
  fromLabel: string | null;
  toLabel: string;
  occurredAt: string;
};

export function buildLeadHistoryItems(
  rows: StageHistoryRow[],
  columns: BoardColumnLabel[]
): LeadHistoryItem[] {
  const labels = new Map(columns.map((column) => [column.key, column.label]));
  const resolveLabel = (stage: string) => labels.get(stage) ?? getLeadStatusLabel(stage);

  return rows.map((row) => ({
    id: row.id,
    fromLabel: row.from_stage ? resolveLabel(row.from_stage) : null,
    toLabel: resolveLabel(row.to_stage),
    occurredAt: row.occurred_at,
  }));
}

export function getLeadHistoryTransitionLabel(item: LeadHistoryItem): string {
  return item.fromLabel
    ? `${item.fromLabel} → ${item.toLabel}`
    : `Entrou em ${item.toLabel}`;
}

export function formatLeadHistoryTimestamp(value: string): string {
  const date = formatDate(value);
  const time = formatTime(value);

  if (date === "-" || time === "-") return "Data indisponível";
  return `${date} às ${time}`;
}
