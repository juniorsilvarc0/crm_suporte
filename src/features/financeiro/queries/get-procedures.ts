import type { Procedure } from "@/features/financeiro/lib/procedure-options";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

/**
 * Catálogo ativo de procedimentos, para o combobox da venda.
 *
 * Arquivados ficam de fora: quem já escolheu um procedimento arquivado não
 * perde a escolha, porque `buildProcedureOptions` reinsere o nome como linha
 * `orphan`.
 *
 * Leitura resiliente: erro loga e devolve vazio, como getDeals.
 */
export async function getProcedures(): Promise<Procedure[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("procedures")
      .select("id, name, default_amount")
      .is("archived_at", null)
      .order("name");

    if (error) {
      console.error("getProcedures failed", error.message);
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      defaultAmount: row.default_amount,
    }));
  } catch (error) {
    console.error("getProcedures threw", error);
    return [];
  }
}
