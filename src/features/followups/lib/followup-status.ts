import type { ColorName } from "@/features/tags/schemas/colors";

// O estado de um follow-up: pendente → concluído, ou cancelado. Espelha o check
// da coluna `followups.status` e o invariante `(status='concluido') =
// (done_at is not null)` (migration 20261008160000).

export const FOLLOWUP_STATUSES = ["pendente", "concluido", "cancelado"] as const;

export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export function isFollowupStatus(value: unknown): value is FollowupStatus {
  return typeof value === "string" && (FOLLOWUP_STATUSES as readonly string[]).includes(value);
}

export const followupStatusLabel: Record<FollowupStatus, string> = {
  pendente: "Pendente",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export const followupStatusColor: Record<FollowupStatus, ColorName> = {
  pendente: "slate",
  concluido: "emerald",
  cancelado: "rose",
};
