import type { AgendaBlock } from "@/features/appointments/lib/agenda-blocks";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// O técnico pelo nome da FK: `agenda_blocks` tem duas relações com app_users
// (técnico e quem cadastrou), então sem o hint é PGRST201.
const BLOCK_SELECT =
  "id, starts_at, ends_at, all_day, reason, assignee:app_users!agenda_blocks_assignee_id_fkey(id, name)";

type BlockRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  reason: string | null;
  assignee: { id: string; name: string } | null;
};

/**
 * Os bloqueios que tocam [início, fim) — sem `endIso`, todos daqui em diante.
 * `null` = a leitura falhou (logado): a página trata como "sem bloqueio" e a
 * rota responde 500, para o cadastro não dizer "nenhum bloqueio" à toa.
 */
export async function getAgendaBlocks(range: { startIso: string; endIso?: string }): Promise<AgendaBlock[] | null> {
  if (!hasSupabaseAdminEnv()) return null;
  try {
    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from("agenda_blocks")
      .select(BLOCK_SELECT)
      .gt("ends_at", range.startIso)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(500);
    if (range.endIso) query = query.lt("starts_at", range.endIso);

    const { data, error } = await query;
    if (error) {
      console.error("[agenda-blocks] getAgendaBlocks", error.code, error.message);
      return null;
    }
    // Campo a campo: só o que a tela usa.
    return ((data ?? []) as unknown as BlockRow[]).map((row) => ({
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allDay: row.all_day,
      reason: row.reason,
      assignee: row.assignee ? { id: row.assignee.id, name: row.assignee.name } : null,
    }));
  } catch (error) {
    console.error("[agenda-blocks] getAgendaBlocks lançou", error);
    return null;
  }
}
