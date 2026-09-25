import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/types";

export type LeadStatusResolution = {
  leadId: string;
  dealId: string | null;
  status: string;
};

export function isAmbiguousLeadStatusError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "21000"
  );
}

function parseStatusResolution(value: Json): LeadStatusResolution {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("invalid_lead_status_response");
  }

  const leadId = value.leadId;
  const dealId = value.dealId;
  const status = value.status;

  if (
    typeof leadId !== "string" ||
    (dealId !== null && typeof dealId !== "string") ||
    typeof status !== "string"
  ) {
    throw new Error("invalid_lead_status_response");
  }

  return { leadId, dealId, status };
}

/**
 * Atualiza a projeção da pessoa e sua única oportunidade ativa na mesma
 * transação. Com mais de uma oportunidade, exige que a interface escolha o
 * card explicitamente em vez de mover um deles por adivinhação.
 */
export async function setLeadStatusFromSingleDeal(
  supabase: SupabaseClient<Database>,
  input: {
    leadId: string;
    status: string;
    occurredAt?: string;
    leadPatch?: Database["public"]["Tables"]["leads"]["Update"];
  }
): Promise<LeadStatusResolution> {
  const { data, error } = await supabase.rpc("set_lead_status_from_single_deal", {
    p_lead_id: input.leadId,
    p_status: input.status,
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
    ...(input.leadPatch ? { p_lead_patch: input.leadPatch as Json } : {}),
  });

  if (error) throw error;
  return parseStatusResolution(data);
}
