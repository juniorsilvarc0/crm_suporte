import { RELAY_SIGNING_SECRET_NAME } from "@/features/settings/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

/**
 * O que a tela sabe da chave de assinatura do relay: se existe e desde quando.
 * O VALOR nunca vem aqui (ele só aparece uma vez, na resposta de quem gera).
 *
 * `unreadable` = a leitura falhou: a tela não diz "sem chave" quando não sabe,
 * e não deixa gerar outra por cima de uma que talvez exista.
 */
export type RelaySigning =
  | { state: "configured"; updatedAt: string }
  | { state: "absent" }
  | { state: "unreadable" };

export async function getRelaySigning(): Promise<RelaySigning> {
  if (!hasSupabaseServerEnv()) return { state: "absent" };

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("app_environment_variables")
      .select("updated_at")
      .eq("name", RELAY_SIGNING_SECRET_NAME)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { state: "configured", updatedAt: data.updated_at } : { state: "absent" };
  } catch (error) {
    console.error("getRelaySigning failed", error);
    return { state: "unreadable" };
  }
}
