import { API_TOKEN_LIST_COLUMNS, toApiTokenListItem } from "@/features/settings/lib/api-token-access";
import type { ApiTokenListItem } from "@/features/settings/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// api_tokens só é acessível pelo service_role (RLS ligado sem policies), então
// esta query usa o admin client — e seleciona colunas explícitas para NUNCA
// trazer o token_hash à aplicação.
export async function getApiTokens(): Promise<ApiTokenListItem[]> {
  if (!hasSupabaseAdminEnv()) return [];
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("api_tokens")
      .select(API_TOKEN_LIST_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("getApiTokens failed", error.message);
      return [];
    }
    return (data ?? []).map(toApiTokenListItem);
  } catch (error) {
    console.error("getApiTokens threw", error);
    return [];
  }
}
