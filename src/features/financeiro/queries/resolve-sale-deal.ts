import type { SupabaseClient } from "@supabase/supabase-js";

import {
  pickSaleDeal,
  type DealForSale,
  type SaleStageColumn,
} from "@/features/financeiro/lib/pick-sale-deal";
import type { Database } from "@/lib/supabase/types";

/**
 * Card de destino da venda quando quem registrou não tinha um em mãos — é o
 * caso da lista de leads, que não carrega `deals`.
 *
 * Nunca lança: sem card, a venda ainda é registrada e a rota devolve
 * `moved: false`, que a tela já sabe explicar.
 */
export async function resolveSaleDeal(
  supabase: SupabaseClient<Database>,
  leadId: string
): Promise<string | null> {
  try {
    const [columnsRes, dealsRes] = await Promise.all([
      supabase.from("board_columns").select("key, position, stage_type"),
      supabase
        .from("deals")
        .select("id, stage, created_at")
        .eq("lead_id", leadId)
        .is("removed_at", null),
    ]);
    if (dealsRes.error) {
      console.error("[sales] resolve_deal_failed", dealsRes.error.message);
      return null;
    }

    return pickSaleDeal(
      (dealsRes.data ?? []) as DealForSale[],
      (columnsRes.data ?? []) as SaleStageColumn[]
    );
  } catch (error) {
    console.error("[sales] resolve_deal_threw", error);
    return null;
  }
}
