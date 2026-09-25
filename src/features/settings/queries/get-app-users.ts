import { isAppUserRole, type AppUser } from "@/features/settings/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// app_users só é acessível pelo service_role (RLS ligado sem policies), então
// esta query usa o admin client — e seleciona colunas explícitas para NUNCA
// trazer o password_hash.
export async function getAppUsers(): Promise<AppUser[]> {
  if (!hasSupabaseAdminEnv()) return [];
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("app_users")
      .select("id, email, name, is_active, role, avatar_url, avatar_color, must_change_password, apelido_atendimento, assinar_mensagens, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("getAppUsers failed", error.message);
      return [];
    }
    return (data ?? []).flatMap(({ role, ...user }) => {
      if (isAppUserRole(role)) return [{ ...user, role }];
      console.warn("getAppUsers: usuário com papel desconhecido omitido", user.id);
      return [];
    });
  } catch (error) {
    console.error("getAppUsers threw", error);
    return [];
  }
}

export async function getAppUser(id: string): Promise<AppUser | null> {
  if (!hasSupabaseAdminEnv()) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("app_users")
      .select("id, email, name, is_active, role, avatar_url, avatar_color, must_change_password, apelido_atendimento, assinar_mensagens, created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("getAppUser failed", error.message);
      return null;
    }
    if (!data) return null;
    // Falha fechado: papel que o app não conhece (ex.: um `paid_traffic` que
    // sobrou no banco) não vira viewer — nunca herda o acesso de `member`.
    const { role, ...user } = data;
    return isAppUserRole(role) ? { ...user, role } : null;
  } catch (error) {
    console.error("getAppUser threw", error);
    return null;
  }
}
