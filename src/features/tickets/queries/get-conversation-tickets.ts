import type { SupabaseClient } from "@supabase/supabase-js";

import {
  orderByDue,
  selectTicketList,
  toTicketListItem,
  toTicketListItems,
} from "@/features/tickets/queries/get-tickets-page";
import type { ConversationTickets } from "@/features/tickets/types";
import type { Database } from "@/lib/supabase/types";

// Teto da lista do chat ("Trocar foco (N abertos)"). Resolvido não é terminal
// e fica até alguém fechar, então uma conversa antiga pode passar disso.
export const MAX_CONVERSATION_TICKETS = 20;

/**
 * Os tickets NÃO terminais da conversa, na ordem "prazo", e o ticket em foco
 * (GET /api/tickets?conversation_id=). Conversa inexistente dá foco nulo e
 * lista vazia, o que é verdade: tickets.conversation_id é `on delete restrict`,
 * então conversa com ticket não some.
 *
 * O foco é sempre não terminal (invariante 5 da migration). Se ele ficou fora
 * das 20 primeiras, entra no fim numa 3ª leitura, para o chip do cabeçalho não
 * ficar sem o ticket. Se, entre as leituras, ele terminou, a lista sai sem ele:
 * o cliente trata foco ausente da lista.
 *
 * LANÇA em erro: a rota responde 500, e o painel mostra "Tentar de novo" em
 * vez de uma lista vazia que pareceria "nenhum ticket aberto".
 */
export async function getConversationTickets(
  supabase: SupabaseClient<Database>,
  conversationId: string
): Promise<ConversationTickets> {
  const [conversationRes, ticketsRes] = await Promise.all([
    supabase
      .from("chat_conversations")
      .select("active_ticket_id")
      .eq("id", conversationId)
      .maybeSingle(),
    orderByDue(
      selectTicketList(supabase).eq("conversation_id", conversationId).eq("is_terminal", false)
    ).limit(MAX_CONVERSATION_TICKETS),
  ]);

  if (conversationRes.error) throw conversationRes.error;
  if (ticketsRes.error) throw ticketsRes.error;

  const tickets = toTicketListItems(ticketsRes.data ?? [], "getConversationTickets");
  if (!tickets) throw new Error("getConversationTickets: linha inesperada");

  const activeTicketId = conversationRes.data?.active_ticket_id ?? null;
  if (activeTicketId && !tickets.some((ticket) => ticket.id === activeTicketId)) {
    const { data, error } = await selectTicketList(supabase)
      .eq("id", activeTicketId)
      .eq("conversation_id", conversationId)
      .eq("is_terminal", false)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const focused = toTicketListItem(data);
      if (!focused) throw new Error("getConversationTickets: linha inesperada");
      tickets.push(focused);
    }
  }

  return { active_ticket_id: activeTicketId, tickets };
}
