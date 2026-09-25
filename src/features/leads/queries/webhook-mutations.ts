import type { SupabaseClient } from "@supabase/supabase-js";

import type { LeadWebhookPayload } from "@/features/leads/schemas/webhook";
import { resolveLeadIdentity } from "@/features/leads/queries/resolve-lead-identity";
import { setLeadStatusFromSingleDeal } from "@/features/leads/queries/set-lead-status";
import { normalizePhone } from "@/lib/formatters/phone";
import type { Database } from "@/lib/supabase/types";

export async function findLeadByPhone(
  supabase: SupabaseClient<Database>,
  phone: string
) {
  const normalizedPhone = normalizePhone(phone);
  const { data, error } = await supabase
    .from("lead_phone_identities")
    .select("lead:leads(*)")
    .eq("normalized_phone", normalizedPhone)
    .maybeSingle();

  if (error) throw error;
  return data?.lead ?? null;
}

export async function upsertLeadFromWebhook(
  supabase: SupabaseClient<Database>,
  payload: LeadWebhookPayload
) {
  const normalizedPhone = normalizePhone(payload.phone);
  const now = new Date().toISOString();
  const identity = await resolveLeadIdentity(supabase, {
    phone: payload.phone,
    name: payload.name,
    source: payload.source ?? "whatsapp",
    createInitialDeal: true,
    lastInteractionAt: now,
  });

  const leadPatch: Database["public"]["Tables"]["leads"]["Update"] = {
    phone: payload.phone,
    normalized_phone: normalizedPhone,
    name: payload.name,
    instagram_user: payload.instagram_user,
    email: payload.email,
    source: payload.source,
    tipo_ensaio: payload.tipo_ensaio,
    agencia_nome: payload.agencia_nome,
    modelo_nome: payload.modelo_nome,
    interesse: payload.interesse,
    valor_estimado: payload.valor_estimado,
    is_recorrente: payload.is_recorrente,
    memoria_contexto: payload.memoria_contexto,
    notes: payload.notes,
    last_message_at: now,
  };

  if (payload.status) {
    await setLeadStatusFromSingleDeal(supabase, {
      leadId: identity.leadId,
      status: payload.status,
      occurredAt: now,
      leadPatch,
    });
  } else {
    const { error } = await supabase
      .from("leads")
      .update({ ...leadPatch, archived_at: null })
      .eq("id", identity.leadId);

    if (error) throw error;
  }

  const { data, error: readError } = await supabase
    .from("leads")
    .select()
    .eq("id", identity.leadId)
    .single();

  if (readError) throw readError;
  return data;
}
