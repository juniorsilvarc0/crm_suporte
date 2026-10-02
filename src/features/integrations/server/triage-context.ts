import type { SupabaseClient } from "@supabase/supabase-js";

import { findContactIdByPhone } from "@/features/contacts/queries/find-contact-by-phone";
import { getCurrentContract } from "@/features/contracts/queries/get-current-contract";
import { allowedTargets } from "@/features/tickets/lib/state-machine";
import { isTicketStatus } from "@/features/tickets/lib/ticket-status";
import { getConversationTickets } from "@/features/tickets/queries/get-conversation-tickets";
import { selectTicketList, toTicketListItems } from "@/features/tickets/queries/get-tickets-page";
import type { TicketTransition } from "@/features/tickets/types";
import { CONTACT_API_SELECT, CUSTOMER_API_SELECT, toApiContact, toApiContract, toApiCustomer } from "@/lib/api/v1/cadastros";
import { contractAlert, type TriageContext } from "@/lib/api/v1/context";
import {
  CONVERSATION_API_SELECT,
  MESSAGE_API_SELECT,
  toApiConversation,
  toApiMessage,
  type ApiMessage,
} from "@/lib/api/v1/conversations";
import { toApiTicket } from "@/lib/api/v1/tickets";
import type { Database } from "@/lib/supabase/types";

// O contexto da triagem (D11), que o /api/v1/context devolve. O relay v1 manda
// só um recorte, montado em relay-envelope.ts (pela conversa da mensagem, não
// pela mais recente do telefone). Só LÊ: não cria contato, não zera as não
// lidas e não mexe no foco.

type Admin = SupabaseClient<Database>;

/** As últimas mensagens da conversa. */
export const CONTEXT_MESSAGES_LIMIT = 20;
/** Os últimos tickets encerrados do contato. */
export const RECENT_TICKETS_LIMIT = 5;

/** Telefone sem dono (ou de contato anonimizado): D11, 200 com `contact: null`. */
const UNKNOWN_CONTACT: TriageContext = {
  contact: null,
  customer: null,
  contract: null,
  contract_alert: "sem_empresa",
  conversation: null,
  open_tickets: [],
  open_tickets_truncated: false,
  recent_tickets: [],
  messages: [],
  ai_may_reply: false,
};

/**
 * A matriz de transições, só ela (o catálogo inteiro são cinco leituras, e o
 * contexto roda a cada mensagem). `null` quando falha ou traz status que o app
 * não conhece: "indisponível", nunca "nenhum destino".
 */
async function readTransitions(supabase: Admin): Promise<TicketTransition[] | null> {
  const { data, error } = await supabase.from("ticket_status_transitions").select("from_status, to_status");
  if (error) {
    console.error("[triage-context] transições", error.message);
    return null;
  }
  const transitions: TicketTransition[] = [];
  for (const row of data ?? []) {
    if (!isTicketStatus(row.from_status) || !isTicketStatus(row.to_status)) {
      console.error("[triage-context] transição inesperada");
      return null;
    }
    transitions.push({ from_status: row.from_status, to_status: row.to_status });
  }
  return transitions;
}

/**
 * Monta o contexto pelo telefone já normalizado. LANÇA se qualquer leitura
 * falhar: um pedaço faltando (sem tickets, sem mensagens) pareceria verdade à
 * IA. A única exceção é a matriz de transições, que vira
 * `allowed_transitions: null` em cada ticket.
 */
export async function buildTriageContext(
  supabase: Admin,
  normalizedPhone: string,
  now: Date = new Date()
): Promise<TriageContext> {
  const contactId = await findContactIdByPhone(supabase, normalizedPhone);
  if (!contactId) return UNKNOWN_CONTACT;

  const [contactRes, conversationRes] = await Promise.all([
    supabase.from("contacts").select(CONTACT_API_SELECT).eq("id", contactId).is("anonymized_at", null).maybeSingle(),
    // A mais recente; conversa sem mensagem (recém-aberta) fica por último.
    supabase
      .from("chat_conversations")
      .select(CONVERSATION_API_SELECT)
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (contactRes.error) throw new Error(`contacts: ${contactRes.error.message}`);
  if (conversationRes.error) throw new Error(`chat_conversations: ${conversationRes.error.message}`);
  if (!contactRes.data) return UNKNOWN_CONTACT;

  const contact = toApiContact(contactRes.data);
  const conversation = conversationRes.data ? toApiConversation(conversationRes.data) : null;
  if (conversationRes.data && !conversation) throw new Error("chat_conversations: linha inesperada");
  const customerId = contact.customer_id;

  const [customerRes, contract, conversationTickets, transitions, messagesRes, recentRes] = await Promise.all([
    customerId ? supabase.from("customers").select(CUSTOMER_API_SELECT).eq("id", customerId).maybeSingle() : null,
    customerId ? getCurrentContract(supabase, customerId) : null,
    conversation ? getConversationTickets(supabase, conversation.id) : null,
    readTransitions(supabase),
    conversation
      ? supabase
          .from("chat_messages")
          .select(MESSAGE_API_SELECT)
          .eq("conversation_id", conversation.id)
          // Nota interna é do time: a IA não a lê, e não tem como repeti-la ao cliente.
          .neq("type", "note")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(CONTEXT_MESSAGES_LIMIT)
      : null,
    // Pelo encerramento, não por updated_at: excluir um analista reescreve os
    // tickets dele (FK set null) e os traria para a frente. Terminal sempre tem
    // closed_at (tickets_closed_at_check).
    selectTicketList(supabase)
      .eq("contact_id", contactId)
      .eq("is_terminal", true)
      .order("closed_at", { ascending: false })
      .order("number", { ascending: false })
      .limit(RECENT_TICKETS_LIMIT),
  ]);

  if (customerRes?.error) throw new Error(`customers: ${customerRes.error.message}`);
  // customer_id tem FK: a empresa sumir entre as leituras é falha, não "sem empresa".
  if (customerRes && !customerRes.data) throw new Error("customers: empresa do contato não encontrada");
  if (messagesRes?.error) throw new Error(`chat_messages: ${messagesRes.error.message}`);
  if (recentRes.error) throw new Error(`ticket_queue: ${recentRes.error.message}`);

  const messages: ApiMessage[] = [];
  for (const row of [...(messagesRes?.data ?? [])].reverse()) {
    const message = toApiMessage(row);
    if (!message) throw new Error("chat_messages: linha inesperada");
    messages.push(message);
  }
  const recent = toTicketListItems(recentRes.data ?? [], "[triage-context] recent_tickets");
  if (!recent) throw new Error("ticket_queue: linha inesperada");

  return {
    contact,
    customer: customerRes?.data ? toApiCustomer(customerRes.data) : null,
    contract: contract ? toApiContract(contract) : null,
    contract_alert: contractAlert(customerId !== null, contract),
    conversation,
    open_tickets: (conversationTickets?.tickets ?? []).map((ticket) => ({
      ...toApiTicket(ticket, now),
      allowed_transitions: transitions ? allowedTargets(transitions, ticket.status) : null,
    })),
    open_tickets_truncated: conversationTickets?.truncated ?? false,
    recent_tickets: recent.map((ticket) => toApiTicket(ticket, now)),
    messages,
    ai_may_reply: conversation?.status === "bot",
  };
}
