import type { FollowupStatus } from "@/lib/supabase/types";

export const followupStatusLabel: Record<FollowupStatus, string> = {
  pendente: "Pendente",
  enviado: "Enviado",
  cancelado: "Cancelado",
};

// Passo da régua de retomada disparada pelo agente. O `step` chega como texto
// livre no webhook (schema: z.string().min(1)); o agente pode mandar "48h"/"5d"/
// "10d" ou "1"/"2"/"3". Alinhar os tokens reais com o time do agente.
export const followupStepLabel: Record<string, string> = {
  "48h": "48 horas",
  "5d": "5 dias",
  "10d": "10 dias",
  "1": "1ª retomada",
  "2": "2ª retomada",
  "3": "3ª retomada",
};

export function getFollowupStepLabel(step: string | null | undefined): string {
  if (!step) return "—";
  return followupStepLabel[step] ?? step; // fallback: mostra o valor cru
}
