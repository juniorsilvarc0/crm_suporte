import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { CONVERSATION_STATUSES, isConversationStatus } from "@/features/chat/lib/conversation-status";
import type { UazapiEnvelope } from "@/features/chat/lib/normalizers/uazapi";
import { CONTRACT_STATUSES } from "@/features/contracts/lib/contract-status";
import { getCurrentContract } from "@/features/contracts/queries/get-current-contract";
import { selectTicketList, toTicketListItem } from "@/features/tickets/queries/get-tickets-page";
import {
  CONTACT_API_SELECT,
  CUSTOMER_API_SELECT,
  contactSchema,
  customerSchema,
  toApiContact,
  toApiCustomer,
} from "@/lib/api/v1/cadastros";
import { CONTRACT_ALERTS, contractAlert } from "@/lib/api/v1/context";
import { ticketSchema, toApiTicket } from "@/lib/api/v1/tickets";
import { signStorageObject } from "@/lib/storage/chat-media";
import type { Database } from "@/lib/supabase/types";

// O envelope do relay v1 (PR 11 do docs/PLANO-FASE-5.md, contrato em
// docs/CONTRATO-RELAY.md): o payload da uazapi sem o `token`, mais os campos do
// CRM na raiz. Contato, empresa e ticket saem no MESMO formato da API v1, pelos
// mesmos mapeadores das rotas: quem integra aprende um formato só. Só LÊ.
//
// Não é o builder do /context (triage-context.ts): aquele acha o contato pelo
// telefone e pega a conversa mais recente dele; aqui a conversa e o contato são
// os DESTA mensagem, e só o que o envelope leva é lido.

type Admin = SupabaseClient<Database>;

export const RELAY_VERSION = 1;
/** Validade da URL da mídia: o agente baixa o arquivo ao receber a mensagem. */
export const RELAY_MEDIA_URL_TTL_SECONDS = 600;

/** Os campos que o CRM acrescenta na raiz. O contrato publicado sai daqui. */
export const relayFieldsSchema = z.strictObject({
  relay_version: z.literal(RELAY_VERSION),
  conversation_id: z.string(),
  conversation_status: z
    .enum(CONVERSATION_STATUSES)
    .describe("bot = a IA conduz; human = um analista assumiu; resolved = encerrada. Só `bot` autoriza a IA a responder."),
  message_id: z.string().describe("O id da mensagem no CRM (GET /conversations/{id}/messages)."),
  contact: contactSchema,
  customer: customerSchema.nullable().describe("null = o contato não está ligado a uma empresa."),
  contract: z.strictObject({
    status: z.enum(CONTRACT_STATUSES).nullable().describe("null = sem empresa, ou a empresa nunca teve contrato."),
    alert: z
      .enum(CONTRACT_ALERTS)
      .nullable()
      .describe("null = contrato ativo. Senão, o motivo do alerta: sem_empresa, sem_contrato, suspenso ou encerrado."),
  }),
  active_ticket: ticketSchema.nullable().describe("O ticket em foco da conversa; null = nenhum."),
  media_url: z
    .string()
    .nullable()
    .describe("URL assinada da mídia, válida por 10 minutos. null = mensagem sem mídia, ou o CRM não tem o arquivo."),
});

export type RelayFields = z.infer<typeof relayFieldsSchema>;

/** Uma mensagem recém-gravada do cliente, com o que o webhook já tem em mãos. */
export type RelayMessage = {
  /** O envelope da uazapi, como chegou. */
  payload: UazapiEnvelope;
  conversationId: string;
  contactId: string;
  messageId: string;
  /** A mídia da mensagem, já no bucket privado. */
  media: { bucket: string; key: string } | null;
};

/** Sem a URL a mensagem segue: o agente vê que é mídia e que ela não veio. */
async function signMedia(supabase: Admin, media: RelayMessage["media"]): Promise<string | null> {
  if (!media) return null;
  try {
    return await signStorageObject(supabase, media.bucket, media.key, RELAY_MEDIA_URL_TTL_SECONDS);
  } catch (error) {
    console.warn("[relay] assinar a mídia falhou:", error);
    return null;
  }
}

/**
 * Os campos do CRM que acompanham a mensagem. LANÇA se uma leitura falhar: um
 * pedaço faltando pareceria verdade à IA. A única exceção é a URL da mídia.
 *
 * O status e o foco são lidos AGORA, da mesma linha da conversa: o envelope é
 * um retrato só. Status que não for um dos conhecidos derruba o envelope, e
 * nunca vira um `bot` suposto (a IA responderia numa conversa que não é dela).
 */
export async function buildRelayFields(
  supabase: Admin,
  message: RelayMessage,
  now: Date = new Date()
): Promise<RelayFields> {
  const { conversationId } = message;

  const [conversationRes, contactRes, mediaUrl] = await Promise.all([
    supabase.from("chat_conversations").select("status, active_ticket_id").eq("id", conversationId).maybeSingle(),
    supabase
      .from("contacts")
      .select(CONTACT_API_SELECT)
      .eq("id", message.contactId)
      .is("anonymized_at", null)
      .maybeSingle(),
    signMedia(supabase, message.media),
  ]);
  if (conversationRes.error) throw new Error(`chat_conversations: ${conversationRes.error.message}`);
  if (!conversationRes.data) throw new Error("chat_conversations: conversa não encontrada");
  const { status, active_ticket_id: activeTicketId } = conversationRes.data;
  if (!isConversationStatus(status)) throw new Error("chat_conversations: status inesperado");
  if (contactRes.error) throw new Error(`contacts: ${contactRes.error.message}`);
  // A mensagem acabou de ser gravada para este contato: não achá-lo é falha.
  if (!contactRes.data) throw new Error("contacts: contato da conversa não encontrado");

  const contact = toApiContact(contactRes.data);
  const customerId = contact.customer_id;
  const [customerRes, contract, focusRes] = await Promise.all([
    customerId ? supabase.from("customers").select(CUSTOMER_API_SELECT).eq("id", customerId).maybeSingle() : null,
    customerId ? getCurrentContract(supabase, customerId) : null,
    // Só o ticket em foco, com os filtros do invariante (desta conversa e não
    // terminal): se ele terminou entre as leituras, não há mais foco.
    activeTicketId
      ? selectTicketList(supabase)
          .eq("id", activeTicketId)
          .eq("conversation_id", conversationId)
          .eq("is_terminal", false)
          .maybeSingle()
      : null,
  ]);
  if (customerRes?.error) throw new Error(`customers: ${customerRes.error.message}`);
  // customer_id tem FK: a empresa sumir entre as leituras é falha, não "sem empresa".
  if (customerRes && !customerRes.data) throw new Error("customers: empresa do contato não encontrada");
  if (focusRes?.error) throw new Error(`ticket_queue: ${focusRes.error.message}`);
  const focused = focusRes?.data ? toTicketListItem(focusRes.data) : null;
  if (focusRes?.data && !focused) throw new Error("ticket_queue: linha inesperada");

  return {
    relay_version: RELAY_VERSION,
    conversation_id: conversationId,
    conversation_status: status,
    message_id: message.messageId,
    contact,
    customer: customerRes?.data ? toApiCustomer(customerRes.data) : null,
    contract: { status: contract?.status ?? null, alert: contractAlert(customerId !== null, contract) },
    active_ticket: focused ? toApiTicket(focused, now) : null,
    media_url: mediaUrl,
  };
}

const CRM_KEYS: ReadonlySet<string> = new Set(Object.keys(relayFieldsSchema.shape));

/** A chave como um leitor de JSON que ignora caixa e espaço a enxergaria. */
const looseKey = (key: string) => key.trim().toLowerCase();

/**
 * O corpo do repasse: o envelope da uazapi SEM o `token` da instância (o agente
 * não usa a credencial do CRM), mais os campos do CRM na raiz.
 *
 * Do provedor não passa nenhuma chave de raiz que se confunda com um campo do
 * CRM, nem em outra caixa (`Conversation_Status`): há leitor de JSON que ignora
 * a caixa e fica com a última que vier. Os campos do CRM vão sempre no fim.
 */
export function relayEnvelope(payload: UazapiEnvelope, fields: RelayFields): Record<string, unknown> & RelayFields {
  const fromProvider = Object.entries(payload).filter(([key]) => {
    const loose = looseKey(key);
    return loose !== "token" && !CRM_KEYS.has(loose);
  });
  return { ...Object.fromEntries(fromProvider), ...fields };
}
