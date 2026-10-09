import type { ColorName } from "@/features/tags/schemas/colors";

// O tipo de um follow-up (retorno ligado a ticket). Enum fixo, rótulo + cor por
// ColorName (UI.md §cores). Espelha o check da coluna `followups.kind`
// (migration 20261008160000).

export const FOLLOWUP_KINDS = ["retorno", "verificacao", "cobranca"] as const;

export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

export function isFollowupKind(value: unknown): value is FollowupKind {
  return typeof value === "string" && (FOLLOWUP_KINDS as readonly string[]).includes(value);
}

export const followupKindLabel: Record<FollowupKind, string> = {
  retorno: "Retorno",
  verificacao: "Verificação",
  cobranca: "Cobrança",
};

export const followupKindColor: Record<FollowupKind, ColorName> = {
  retorno: "blue",
  verificacao: "violet",
  cobranca: "amber",
};

/** Para o FormSelect de tipo. */
export const followupKindOptions = FOLLOWUP_KINDS.map((kind) => ({
  value: kind,
  label: followupKindLabel[kind],
}));
