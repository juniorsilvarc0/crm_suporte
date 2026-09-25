import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ATTENDED_STAGE,
  selectAttendedDeals,
  type DealForAttendance,
} from "@/features/deals/lib/attendance";
import type { Database } from "@/lib/supabase/types";

export type SyncAttendanceResult = {
  moved: string[];
  stage: string | null;
  ambiguous: boolean;
};

/**
 * Leva os cards do funil junto com o comparecimento.
 *
 * O funil renderiza `deals`; marcar comparecimento escrevia só em `appointments`
 * e `leads`, então o card ficava parado. Esta função fecha esse buraco e é
 * chamada por TODA rota que marca comparecimento.
 *
 * Nunca lança: comparecimento registrado é o que importa, e falhar aqui não pode
 * derrubar a ação principal. Devolve o que moveu para quem chamou decidir o log.
 */
export async function syncDealsOnAttendance(
  supabase: SupabaseClient<Database>,
  args: { leadId: string; appointmentId?: string | null }
): Promise<SyncAttendanceResult> {
  const untouched: SyncAttendanceResult = {
    moved: [],
    stage: null,
    ambiguous: false,
  };

  try {
    // O board é dinâmico: sem a coluna de destino não há para onde mover.
    const { data: columns, error: columnsError } = await supabase
      .from("board_columns")
      .select("key, stage_type");
    if (columnsError) return untouched;

    const target = columns?.find((column) => column.key === ATTENDED_STAGE);
    if (!target) return untouched;

    const closedStages = (columns ?? [])
      .filter((column) => column.stage_type === "won" || column.stage_type === "lost")
      .map((column) => column.key);

    const { data: deals, error: dealsError } = await supabase
      .from("deals")
      .select("id, stage, appointment_id")
      .eq("lead_id", args.leadId)
      .is("removed_at", null);
    if (dealsError) return { moved: [], stage: ATTENDED_STAGE, ambiguous: false };

    const selection = selectAttendedDeals({
      deals: (deals ?? []) as DealForAttendance[],
      appointmentId: args.appointmentId ?? null,
      closedStages,
    });
    if (selection.ids.length === 0) {
      return {
        moved: [],
        stage: ATTENDED_STAGE,
        ambiguous: selection.ambiguous,
      };
    }

    // `compareceu` é etapa aberta: won_at/lost_at ficam nulos, como em
    // /api/deals/[id]/stage. O trigger trg_deals_stage_history registra a
    // transição sozinho.
    const { error: updateError } = await supabase
      .from("deals")
      .update({ stage: ATTENDED_STAGE, won_at: null, lost_at: null })
      .in("id", selection.ids);
    if (updateError) {
      console.error("[attendance] deals_update_failed", updateError.message);
      return { moved: [], stage: ATTENDED_STAGE, ambiguous: false };
    }

    return { moved: selection.ids, stage: ATTENDED_STAGE, ambiguous: false };
  } catch (error) {
    console.error("[attendance] sync_failed", error);
    return untouched;
  }
}
