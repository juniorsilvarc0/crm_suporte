import {
  onlyPending,
  orderByDue,
  selectTicketList,
  toTicketListItems,
  type TicketListQuery,
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

// Resolvido com resposta do cliente primeiro: ele pede ação e não tem prazo, e
// na ordem "prazo" iria para o fim e cairia no corte de 8. Depois, a da lista.
function orderQueue(query: TicketListQuery): TicketListQuery {
  return orderByDue(query.order("replied_after_resolve", { ascending: false }));
}

/**
 * As duas filas do Início, no recorte "pendentes" da lista (onlyPending: relógio
 * correndo ou pausado, mais o resolvido em que o cliente respondeu depois):
 * - **mine**: os pendentes do analista;
 * - **unassigned**: os pendentes sem responsável.
 *
 * O "Ver todos (N)" abre a lista com o mesmo recorte, então o N é o total dela.
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
      orderQueue(
        onlyPending(selectTicketList(supabase, { count: "exact" })).eq("assigned_to_user_id", viewerId)
      ).limit(TICKET_QUEUE_LIMIT),
      orderQueue(
        onlyPending(selectTicketList(supabase, { count: "exact" })).is("assigned_to_user_id", null)
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
