import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePhone } from "@/lib/formatters/phone";
import type { Database, Json } from "@/lib/supabase/types";

export type LeadIdentityResolution = {
  leadId: string;
  normalizedPhone: string;
  created: boolean;
  initialDealId: string | null;
};

type ResolveLeadIdentityInput = {
  phone: string;
  name?: string | null;
  source?: string;
  createInitialDeal?: boolean;
  lastInteractionAt?: string | null;
  reactivate?: boolean;
};

function parseResolution(value: Json): LeadIdentityResolution {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("invalid_lead_identity_response");
  }

  const leadId = value.leadId;
  const normalizedPhone = value.normalizedPhone;
  const created = value.created;
  const initialDealId = value.initialDealId;

  if (
    typeof leadId !== "string" ||
    typeof normalizedPhone !== "string" ||
    typeof created !== "boolean" ||
    (initialDealId !== null && typeof initialDealId !== "string")
  ) {
    throw new Error("invalid_lead_identity_response");
  }

  return { leadId, normalizedPhone, created, initialDealId };
}

/**
 * Resolve a pessoa canônica por telefone exato em uma única transação no banco.
 * A normalização local só falha cedo; a RPC repete a regra e é a autoridade.
 */
export async function resolveLeadIdentity(
  supabase: SupabaseClient<Database>,
  input: ResolveLeadIdentityInput
): Promise<LeadIdentityResolution> {
  const normalizedPhone = normalizePhone(input.phone);
  if (!/^\d{10,15}$/.test(normalizedPhone)) {
    throw new Error("invalid_normalized_phone");
  }

  const { data, error } = await supabase.rpc("resolve_lead_identity", {
    p_phone: input.phone,
    p_name: input.name ?? null,
    p_source: input.source ?? "whatsapp",
    p_create_initial_deal: input.createInitialDeal ?? false,
    p_last_interaction_at: input.lastInteractionAt ?? null,
    p_reactivate: input.reactivate ?? true,
  });

  if (error) throw error;
  return parseResolution(data);
}

