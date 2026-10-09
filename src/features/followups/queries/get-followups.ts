import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

import type { FollowupListItem } from "@/features/followups/types";

// Leitura resiliente (service role, servidor): erro vira [] + log. Embed do
// ticket com hint de FK pelo nome da constraint — `ticket_id` tem duas relações
// no gerador (tickets e a view ticket_queue), então sem o hint é PGRST201.
const FOLLOWUP_SELECT = `
  id, ticket_id, kind, status, due_at, notes, done_at,
  created_by_user_id, created_at, updated_at,
  ticket:tickets!followups_ticket_id_fkey(id, number, title, status)
`;

/** Os retornos de um ticket, do mais próximo (por prazo) ao mais distante. */
export async function getTicketFollowups(ticketId: string): Promise<FollowupListItem[]> {
  if (!hasSupabaseAdminEnv()) return [];
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("followups")
      .select(FOLLOWUP_SELECT)
      .eq("ticket_id", ticketId)
      .order("due_at", { ascending: true });
    if (error) {
      console.error("[followups] getTicketFollowups", error.code, error.message);
      return [];
    }
    return (data ?? []) as unknown as FollowupListItem[];
  } catch (error) {
    console.error("[followups] getTicketFollowups lançou", error);
    return [];
  }
}
