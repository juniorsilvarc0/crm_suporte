import type { IntegrationStatus } from "@/lib/supabase/types";

export const integrationStatusLabel: Record<IntegrationStatus, string> = {
  ok: "Sucesso",
  error: "Erro",
};
