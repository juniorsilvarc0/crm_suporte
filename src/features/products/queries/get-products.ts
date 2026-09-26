import type { ProductOption } from "@/features/products/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

/**
 * Produtos (filas) ATIVOS, por nome — as opções do formulário de contrato.
 * Produto arquivado só aparece no contrato que já o cobria. Leitura
 * resiliente: erro loga e devolve `null` (não `[]`) — a ficha não cai, e o
 * combobox diz "não foi possível carregar" em vez de "nenhum cadastrado".
 */
export async function getProducts(): Promise<ProductOption[] | null> {
  if (!hasSupabaseAdminEnv()) return null;

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, name, niche, color, archived_at")
      .is("archived_at", null)
      .order("name", { ascending: true });
    if (error) {
      console.error("getProducts failed", error.message);
      return null;
    }
    return data ?? [];
  } catch (error) {
    console.error("getProducts threw", error);
    return null;
  }
}
