import type { SupabaseClient } from "@supabase/supabase-js";

import type { FollowupWebhookPayload } from "@/features/followups/schemas/webhook";
import type { Database } from "@/lib/supabase/types";

// Registra (ou atualiza) um follow-up disparado pelo agente externo. O agente
// envia DOIS eventos com a MESMA idempotency_key: (1) envio da retomada e, mais
// tarde, (2) resposta do lead (replied/recovered/replied_at). O evento de
// resposta NÃO traz `message` nem `sent_at`.
//
// Por isso não dá para usar upsert cego: o supabase-js faz `SET col = EXCLUDED.col`
// para cada chave do objeto (sem COALESCE), então o 2º evento zeraria o texto e o
// horário reais do envio. A estratégia é read-modify-write: se a chave já existe,
// atualiza SÓ as colunas que o evento realmente traz; senão, insere a linha completa.
// O índice único followups_idempotency_key_uidx é a rede contra duplicatas.
export async function createFollowupFromWebhook(
  supabase: SupabaseClient<Database>,
  payload: FollowupWebhookPayload & { leadId?: string | null }
) {
  const table = supabase.from("followups");
  const key = payload.idempotency_key ?? null;

  // step/replied/recovered agora são colunas: `message` guarda só o texto humano
  // (mensagem enviada, senão o motivo) — sem os marcadores [step]/(recuperado).
  const humanMessage = payload.message ?? payload.reason ?? null;

  if (key) {
    const { data: existing, error: findError } = await table
      .select("id")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (findError) {
      throw findError;
    }

    if (existing) {
      // 2º evento (resposta): atualiza só o que ele traz. replied/recovered são
      // "sticky true" — um retry do envio (replied:false) não reverte a recuperação.
      const patch: Database["public"]["Tables"]["followups"]["Update"] = {
        step: payload.step,
      };
      if (payload.replied) patch.replied = true;
      if (payload.recovered) patch.recovered = true;
      if (payload.replied_at) patch.replied_at = payload.replied_at;
      // conteúdo/tempos só quando o evento os traz (evento de envio ou retry dele):
      // preserva o texto e o horário reais quando a resposta chega sem eles.
      if (humanMessage != null) patch.message = humanMessage;
      if (payload.sent_at) {
        patch.sent_at = payload.sent_at;
        patch.scheduled_for = payload.sent_at;
      }

      const { data, error } = await table
        .update(patch)
        .eq("idempotency_key", key)
        .select()
        .single();
      if (error) {
        throw error;
      }
      return data;
    }
  }

  // Primeira gravação desta chave (ou payload sem chave): INSERT completo.
  // scheduled_for é NOT NULL — usa sent_at, senão replied_at (edge: resposta antes
  // do envio), senão agora.
  const anchorTs =
    payload.sent_at ?? payload.replied_at ?? new Date().toISOString();

  const row: Database["public"]["Tables"]["followups"]["Insert"] = {
    lead_id: payload.leadId ?? null,
    scheduled_for: anchorTs,
    status: "enviado",
    message: humanMessage,
    sent_at: payload.sent_at ?? null,
    step: payload.step,
    replied: payload.replied,
    replied_at: payload.replied_at ?? null,
    recovered: payload.recovered,
    idempotency_key: key,
  };

  const { data, error } = await table.insert(row).select().single();
  if (error) {
    throw error;
  }
  return data;
}
