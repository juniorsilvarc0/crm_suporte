import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePhone } from "@/lib/formatters/phone";
import type { Database, Json } from "@/lib/supabase/types";

export type ContactIdentityResolution = {
  contactId: string;
  normalizedPhone: string;
  created: boolean;
};

/** Valores do check `contacts.source`. */
export type ContactSource = "whatsapp" | "indicacao" | "manual" | "api";

type ResolveContactIdentityInput = {
  phone: string;
  name?: string | null;
  source?: ContactSource;
  lastInteractionAt?: string | null;
  reactivate?: boolean;
};

function parseResolution(value: Json): ContactIdentityResolution {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("invalid_contact_identity_response");
  }

  const contactId = value.contactId;
  const normalizedPhone = value.normalizedPhone;
  const created = value.created;

  if (
    typeof contactId !== "string" ||
    typeof normalizedPhone !== "string" ||
    typeof created !== "boolean"
  ) {
    throw new Error("invalid_contact_identity_response");
  }

  return { contactId, normalizedPhone, created };
}

/**
 * Resolve a pessoa canônica por telefone exato em uma única transação no banco.
 * A normalização local só falha cedo; a RPC repete a regra e é a autoridade.
 */
export async function resolveContactIdentity(
  supabase: SupabaseClient<Database>,
  input: ResolveContactIdentityInput
): Promise<ContactIdentityResolution> {
  const normalizedPhone = normalizePhone(input.phone);
  if (!/^\d{10,15}$/.test(normalizedPhone)) {
    throw new Error("invalid_normalized_phone");
  }

  // Ausente = o default da RPC (nome nulo, sem interação, reativa).
  const { data, error } = await supabase.rpc("resolve_contact_identity", {
    p_phone: input.phone,
    p_name: input.name ?? undefined,
    p_source: input.source ?? "whatsapp",
    p_last_interaction_at: input.lastInteractionAt ?? undefined,
    p_reactivate: input.reactivate ?? true,
  });

  if (error) throw error;
  return parseResolution(data);
}
