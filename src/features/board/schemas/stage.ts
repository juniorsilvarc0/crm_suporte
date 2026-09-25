import type { ColorName } from "@/features/tags/schemas/colors";

export type StageType = "open" | "won" | "lost";

export const STAGE_TYPES: StageType[] = ["open", "won", "lost"];

export const stageTypeLabel: Record<StageType, string> = {
  open: "Aberto",
  won: "Ganho",
  lost: "Perdido",
};

export const stageTypeColor: Record<StageType, ColorName> = {
  open: "blue",
  won: "emerald",
  lost: "rose",
};

// Normaliza um valor livre do banco para um StageType válido.
export function toStageType(value: string | null | undefined): StageType {
  return value === "won" || value === "lost" ? value : "open";
}
