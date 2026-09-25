import type { SupabaseClient } from "@supabase/supabase-js";

import {
  projectLeadStatus,
  type DealForLeadStatus,
  type StageColumn,
} from "@/features/deals/lib/lead-status";
import { statusTimestampColumn } from "@/features/leads/lib/status-timestamp";
import type { Database } from "@/lib/supabase/types";

export type SyncLeadStatusResult = { status: string | null; changed: boolean };

/**
 * Reprojeta `leads.status` a partir dos cards do lead.
 *
 * O funil é a verdade; `leads.status` é a projeção que a lista de leads, os
 * filtros e o dashboard leem. Esta função é chamada por TODA rota que cria,
 * move ou apaga um card — mesmo contrato de `syncDealsOnAttendance`, ao lado.
 *
 * Nunca lança: o card já se moveu, e falhar aqui não pode derrubar a ação
 * principal nem desfazer o que o usuário viu acontecer na tela.
 */
export async function syncLeadStatusFromDeals(
  supabase: SupabaseClient<Database>,
  args: { leadId: string }
): Promise<SyncLeadStatusResult> {
  const untouched: SyncLeadStatusResult = { status: null, changed: false };

  try {
    const [columnsRes, dealsRes] = await Promise.all([
      supabase.from("board_columns").select("key, position, stage_type"),
      supabase
        .from("deals")
        .select("stage")
        .eq("lead_id", args.leadId)
        .is("removed_at", null),
    ]);
    if (columnsRes.error || dealsRes.error) return untouched;

    const status = projectLeadStatus(
      (dealsRes.data ?? []) as DealForLeadStatus[],
      (columnsRes.data ?? []) as StageColumn[]
    );
    // Lead sem card (o último foi apagado) fica como está: rebaixar para "novo"
    // apagaria o histórico de quem já era cliente.
    if (!status) return untouched;

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("status, qualificado_at, agendado_at, compareceu_at, cliente_at")
      .eq("id", args.leadId)
      .maybeSingle();
    if (leadError || !lead) return untouched;

    // O marco só é carimbado na PRIMEIRA vez que o lead chega na etapa.
    // `agendado_at` guarda a data do agendamento, escrita por /api/appointments;
    // sobrescrever com "agora" porque alguém arrastou o card corromperia o
    // avgConversionDays e as coortes do rastreamento.
    const column = statusTimestampColumn(status);
    const current: Record<string, string | null> = {
      qualificado_at: lead.qualificado_at,
      agendado_at: lead.agendado_at,
      compareceu_at: lead.compareceu_at,
      cliente_at: lead.cliente_at,
    };
    const stamp =
      column && current[column] == null ? { [column]: new Date().toISOString() } : {};

    if (lead.status === status && Object.keys(stamp).length === 0) {
      return { status, changed: false };
    }

    const { error } = await supabase
      .from("leads")
      .update({ status, ...stamp })
      .eq("id", args.leadId);

    if (error) {
      console.error("[lead-status] update_failed", error.message);
      return { status, changed: false };
    }

    return { status, changed: true };
  } catch (error) {
    console.error("[lead-status] sync_failed", error);
    return untouched;
  }
}
