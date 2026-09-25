import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppointmentWebhookPayload } from "@/features/appointments/schemas/webhook";
import type { Database } from "@/lib/supabase/types";

export async function upsertAppointmentFromWebhook(
  supabase: SupabaseClient<Database>,
  payload: AppointmentWebhookPayload & { leadId?: string | null }
) {
  const row = {
    lead_id: payload.leadId,
    scheduled_at: payload.scheduled_at,
    tipo_ensaio: payload.tipo_ensaio,
    duration_min: payload.duration_min,
    notes: payload.notes,
    status: payload.status,
    idempotency_key: payload.idempotency_key ?? null,
  };

  // Com idempotency_key, o upsert na chave única evita duplicar em retries do n8n.
  const table = supabase.from("appointments");
  const query = payload.idempotency_key
    ? table.upsert(row, { onConflict: "idempotency_key" })
    : table.insert(row);

  const { data, error } = await query.select().single();

  if (error) throw error;
  return data;
}
