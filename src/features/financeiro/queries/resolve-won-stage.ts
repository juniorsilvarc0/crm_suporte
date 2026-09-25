import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * Primeira etapa de ganho do board, por posição.
 *
 * A rota antiga pegava a primeira `stage_type = 'won'` e, quando não achava,
 * caía num literal `"cliente"` que pode não existir em `board_columns` — o card
 * ia parar numa coluna órfã. Aqui, não achar devolve `null` e quem chama decide:
 * a venda é registrada assim mesmo e o card fica onde está.
 *
 * Leitura resiliente: erro loga e devolve `null`, como getDeals e
 * getLeadAttributions. Perder a venda por causa de configuração de funil seria
 * pior que não mover o card.
 */
export async function resolveWonStage(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("board_columns")
      .select("key, position")
      .eq("stage_type", "won")
      .order("position")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("resolveWonStage failed", error.message);
      return null;
    }
    return data?.key ?? null;
  } catch (error) {
    console.error("resolveWonStage threw", error);
    return null;
  }
}
