import {
  orderByDue,
  selectTicketList,
  toTicketListItems,
  type TicketListRow,
} from "@/features/tickets/queries/get-tickets-page";
import type { TicketQueue, TicketQueueSection } from "@/features/tickets/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// Itens por seção do Início; o resto fica no "Ver todos (N)".
export const TICKET_QUEUE_LIMIT = 8;

const failedSection = (): TicketQueueSection => ({ items: [], total: 0, failed: true });

function toSection(
  section: string,
  result: { data: TicketListRow[] | null; error: { message: string } | null; count: number | null }
): TicketQueueSection {
  if (result.error) {
    console.error(`getTicketQueue ${section} failed`, result.error.message);
    return failedSection();
  }
  const items = toTicketListItems(result.data ?? [], `getTicketQueue ${section}`);
  if (!items) return failedSection();
  return { items, total: result.count ?? items.length, failed: false };
}

/**
 * As duas filas do Início, na ordem "prazo" (a mesma da lista):
 * - **mine**: os tickets NÃO terminais do analista. Resolvido entra, para o
 *   selo "Respondeu após resolver" (last_inbound_at > resolved_at);
 * - **unassigned**: relógio não parado (sla_mode <> stopped) e sem responsável.
 *
 * Leitura resiliente por seção: a falha de uma não apaga a outra, e cada uma
 * mostra o próprio "Tentar de novo".
 */
export async function getTicketQueue(viewerId: string): Promise<TicketQueue> {
  const fetchedAt = new Date().toISOString();
  if (!hasSupabaseAdminEnv()) {
    return { mine: failedSection(), unassigned: failedSection(), fetchedAt };
  }

  try {
    const supabase = createSupabaseAdminClient();
    const [mineRes, unassignedRes] = await Promise.all([
      orderByDue(
        selectTicketList(supabase, { count: "exact" })
          .eq("assigned_to_user_id", viewerId)
          .eq("is_terminal", false)
      ).limit(TICKET_QUEUE_LIMIT),
      orderByDue(
        selectTicketList(supabase, { count: "exact" })
          .is("assigned_to_user_id", null)
          .neq("sla_mode", "stopped")
      ).limit(TICKET_QUEUE_LIMIT),
    ]);

    return {
      mine: toSection("mine", mineRes),
      unassigned: toSection("unassigned", unassignedRes),
      fetchedAt,
    };
  } catch (error) {
    console.error("getTicketQueue threw", error);
    return { mine: failedSection(), unassigned: failedSection(), fetchedAt };
  }
}
