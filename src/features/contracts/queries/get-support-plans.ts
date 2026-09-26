import type { SupportPlanOption } from "@/features/contracts/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

/**
 * Planos de suporte ATIVOS, por nome — as opções do formulário de contrato.
 * Plano arquivado só aparece no contrato que já o tinha. Leitura resiliente:
 * erro loga e devolve `null` (não `[]`) — a ficha não cai, e o combobox diz
 * "não foi possível carregar" em vez de "nenhum cadastrado".
 */
export async function getSupportPlans(): Promise<SupportPlanOption[] | null> {
  if (!hasSupabaseAdminEnv()) return null;

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("support_plans")
      .select("id, name, description, archived_at")
      .is("archived_at", null)
      .order("name", { ascending: true });
    if (error) {
      console.error("getSupportPlans failed", error.message);
      return null;
    }
    return data ?? [];
  } catch (error) {
    console.error("getSupportPlans threw", error);
    return null;
  }
}
