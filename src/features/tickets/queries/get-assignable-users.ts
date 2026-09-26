import type { TicketTeamMember } from "@/features/tickets/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// Colunas explícitas: app_users tem grant por coluna (sem password_hash), e a
// tela de ticket não precisa de e-mail nem de papel — getAppUsers traz os dois.
const TEAM_SELECT = "id, name, avatar_color, avatar_url, is_active";

/**
 * A equipe para a tela do ticket: o "Atribuir" (só os ATIVOS, filtrados por
 * `is_active`) e os nomes da trilha e das notas, que incluem quem foi
 * desativado — sem ele, a timeline assinaria "Usuário removido" o que é de
 * alguém que só está inativo. Em ordem de nome.
 *
 * `null` (logado) quando a leitura falhou: a tela diz "não foi possível
 * carregar a equipe", nunca "ninguém para atribuir".
 */
export async function getAssignableUsers(): Promise<TicketTeamMember[] | null> {
  if (!hasSupabaseAdminEnv()) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("app_users")
      .select(TEAM_SELECT)
      .order("name", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.error("getAssignableUsers failed", error.message);
      return null;
    }
    return (data ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      avatar_color: user.avatar_color,
      avatar_url: user.avatar_url,
      is_active: user.is_active,
    }));
  } catch (error) {
    console.error("getAssignableUsers threw", error);
    return null;
  }
}
