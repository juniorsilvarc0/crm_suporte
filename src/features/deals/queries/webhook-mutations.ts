import type { SupabaseClient } from "@supabase/supabase-js";

import type { DealWebhookPayload } from "@/features/deals/schemas/webhook";
import type { Database } from "@/lib/supabase/types";

const LEAD_SELECT = "*, lead:leads(name, phone, normalized_phone)";

// Cria um deal (card do funil) para um lead. Cada chamada = um card novo
// (é o que permite ao cliente recorrente ter vários cards). Com idempotency_key,
// o upsert na chave única evita duplicar em retries.
export async function createDealFromWebhook(
  supabase: SupabaseClient<Database>,
  payload: DealWebhookPayload & { leadId: string; stage: string; source?: string }
) {
  const row = {
    lead_id: payload.leadId,
    stage: payload.stage,
    tipo_ensaio: payload.tipo_ensaio ?? null,
    valor: payload.valor ?? null,
    scheduled_at: payload.scheduled_at ?? null,
    title: payload.title ?? null,
    notes: payload.notes ?? null,
    source: payload.source ?? "agent",
    idempotency_key: payload.idempotency_key ?? null,
  };

  const table = supabase.from("deals");
  const query = payload.idempotency_key
    ? table.upsert(row, { onConflict: "idempotency_key" })
    : table.insert(row);

  const { data, error } = await query.select(LEAD_SELECT).single();
  if (error) throw error;
  return data;
}

// Cria (idempotente) o deal correspondente a um agendamento recém-criado.
// Etapa inicial 'agendado'; dedupe por appointment_id (índice único) — assim um
// retry do POST /appointments não gera dois cards.
export async function createDealForAppointment(
  supabase: SupabaseClient<Database>,
  args: {
    leadId: string;
    appointmentId: string;
    tipo_ensaio?: string | null;
    scheduled_at?: string | null;
  }
) {
  const row = {
    lead_id: args.leadId,
    appointment_id: args.appointmentId,
    stage: "agendado",
    tipo_ensaio: args.tipo_ensaio ?? null,
    scheduled_at: args.scheduled_at ?? null,
    source: "appointment",
  };

  const { data, error } = await supabase
    .from("deals")
    .upsert(row, { onConflict: "appointment_id" })
    .select(LEAD_SELECT)
    .single();
  if (error) throw error;
  return data;
}
