import { z } from "zod";

import { CONVERSATION_STATUSES } from "@/features/chat/lib/conversation-status";
import type { MessageDeliveryStatus, MessageDirection, MessageType } from "@/features/chat/types";
import { isPgSafeText, PG_UNSAFE_TEXT_MESSAGE } from "@/features/tickets/schemas/ticket";
import type { TicketMessageSender } from "@/features/tickets/types";
import { UUID_RE } from "@/lib/validation/uuid";

// Conversa e mensagem da API v1. Vocabulário dos checks de _chat; o
// `satisfies` amarra cada lista ao tipo do app. Sem mídia por URL: o
// `media_url` do banco é uma rota de SESSÃO (/api/chat/media/<id>), inútil
// para um token.

// Exportadas: a timeline do ticket (ticket-activity.ts) publica as mesmas.
export const DIRECTIONS = ["inbound", "outbound"] as const satisfies readonly MessageDirection[];
export const SENDERS = ["contact", "agent", "ai", "system", "device"] as const satisfies readonly TicketMessageSender[];
export const MESSAGE_TYPES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "contact",
  "template",
  "note",
] as const satisfies readonly MessageType[];
export const DELIVERY_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
] as const satisfies readonly MessageDeliveryStatus[];

const oneOf = <T extends string>(list: readonly T[], value: string): value is T => list.some((item) => item === value);

export const conversationSchema = z.strictObject({
  id: z.string(),
  status: z
    .enum(CONVERSATION_STATUSES)
    .describe("bot = a IA conduz; human = um analista assumiu; resolved = encerrada."),
  /** O ticket em foco: mensagem nova nasce nele. */
  active_ticket_id: z.string().nullable(),
  last_message_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
});

export const messageSchema = z.strictObject({
  id: z.string(),
  direction: z.enum(DIRECTIONS),
  sender_type: z
    .enum(SENDERS)
    .describe(
      "contact = o cliente; agent = analista pelo CRM; ai = a IA (token do tipo ai); system = automático " +
        "(token de integração); device = o celular da empresa, fora do CRM."
    ),
  type: z.enum(MESSAGE_TYPES),
  /** Texto, ou a legenda / nome do arquivo da mídia. `null` na mensagem apagada. */
  content: z.string().nullable(),
  media_mime_type: z.string().nullable(),
  is_deleted: z.boolean(),
  delivery_status: z.enum(DELIVERY_STATUSES),
  /** O ticket em foco quando a mensagem chegou. */
  ticket_id: z.string().nullable(),
  quoted_message_id: z.string().nullable(),
  created_at: z.string(),
});

export type ApiConversation = z.infer<typeof conversationSchema>;
export type ApiMessage = z.infer<typeof messageSchema>;

// Colunas explícitas: nada de metadata, bucket, chave nem URL de sessão.
export const CONVERSATION_API_SELECT = "id, status, active_ticket_id, last_message_at, archived_at, created_at";
export const MESSAGE_API_SELECT =
  "id, direction, sender_type, type, content, media_mime_type, is_deleted, delivery_status, ticket_id, quoted_message_id, created_at";

type ConversationRow = Omit<ApiConversation, "status"> & { status: string };
type MessageRow = Omit<ApiMessage, "direction" | "sender_type" | "type" | "delivery_status"> & {
  direction: string;
  sender_type: string;
  type: string;
  delivery_status: string;
};

/** `null` = linha fora do check do banco: quem chama falha a leitura, não a esconde. */
export function toApiConversation(row: ConversationRow): ApiConversation | null {
  if (!oneOf(CONVERSATION_STATUSES, row.status)) return null;
  return {
    id: row.id,
    status: row.status,
    active_ticket_id: row.active_ticket_id,
    last_message_at: row.last_message_at,
    archived_at: row.archived_at,
    created_at: row.created_at,
  };
}

/** `null` = linha fora do check do banco: quem chama falha a leitura, não a esconde. */
export function toApiMessage(row: MessageRow): ApiMessage | null {
  const { direction, sender_type: sender, type, delivery_status: delivery } = row;
  if (
    !oneOf(DIRECTIONS, direction) ||
    !oneOf(SENDERS, sender) ||
    !oneOf(MESSAGE_TYPES, type) ||
    !oneOf(DELIVERY_STATUSES, delivery)
  ) {
    return null;
  }
  return {
    id: row.id,
    direction,
    sender_type: sender,
    type,
    content: row.content,
    media_mime_type: row.media_mime_type,
    is_deleted: row.is_deleted,
    delivery_status: delivery,
    ticket_id: row.ticket_id,
    quoted_message_id: row.quoted_message_id,
    created_at: row.created_at,
  };
}

// ─── GET /conversations/{id} e /messages ─────────────────────────────────────

export const conversationDetailSchema = conversationSchema.extend({
  /** De quem é a conversa (GET /contacts/{id}). */
  contact_id: z.string(),
});

export const conversationMessageSchema = messageSchema.extend({
  /** Quem do time enviou (mensagem `agent`), quando conhecido. */
  sent_by_user_id: z.string().nullable(),
  /** O token que escreveu (mensagem `ai` ou `system`). */
  sent_by_token_id: z.string().nullable(),
});

export type ApiConversationDetail = z.infer<typeof conversationDetailSchema>;
export type ApiConversationMessage = z.infer<typeof conversationMessageSchema>;

export const CONVERSATION_DETAIL_SELECT = `${CONVERSATION_API_SELECT}, contact_id` as const;
export const CONVERSATION_MESSAGE_SELECT = `${MESSAGE_API_SELECT}, sent_by_user_id, sent_by_token_id` as const;

/** `null` = linha fora do check do banco: quem chama falha a leitura, não a esconde. */
export function toApiConversationDetail(row: ConversationRow & { contact_id: string }): ApiConversationDetail | null {
  const conversation = toApiConversation(row);
  return conversation ? { ...conversation, contact_id: row.contact_id } : null;
}

/** `null` = linha fora do check do banco: quem chama falha a leitura, não a esconde. */
export function toApiConversationMessage(
  row: MessageRow & { sent_by_user_id: string | null; sent_by_token_id: string | null }
): ApiConversationMessage | null {
  const message = toApiMessage(row);
  return message
    ? { ...message, sent_by_user_id: row.sent_by_user_id, sent_by_token_id: row.sent_by_token_id }
    : null;
}

// ─── Escritas ────────────────────────────────────────────────────────────────

const ticketIdField = z
  .string({ error: "Ticket inválido." })
  .regex(UUID_RE, { error: "Ticket inválido." })
  .nullable();

/**
 * POST /conversations/{id}/handoff. Os tetos são os de conversation_handoff
 * (migration _conversas_ia), medidos depois do trim.
 */
export const handoffBodySchema = z.strictObject(
  {
    reason: z
      .string({ error: "Informe o motivo." })
      .trim()
      .min(1, { error: "Informe o motivo." })
      .max(500, { error: "Máximo de 500 caracteres." })
      .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE)
      .describe("Por que a conversa passa para um humano. Vai para a trilha do ticket e para a nota interna."),
    summary: z
      .string({ error: "Resumo inválido." })
      .trim()
      .max(4000, { error: "Máximo de 4.000 caracteres." })
      .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE)
      .nullable()
      .optional()
      .describe("O que o analista precisa saber para continuar. Vai só para a nota interna no chat."),
    ticket_id: ticketIdField
      .optional()
      .describe("O ticket (uuid) a que o pedido se refere. Sem ele, vale o ticket em foco da conversa."),
  },
  { error: "Envie um objeto JSON." }
);

/** PUT /conversations/{id}/active-ticket. `null` tira o foco. */
export const activeTicketBodySchema = z.strictObject(
  {
    ticket_id: ticketIdField.describe("O ticket (uuid) que passa a receber as mensagens novas; null = sem foco."),
  },
  { error: "Envie um objeto JSON." }
);

// O resultado das escritas é o da OPERAÇÃO, não a conversa: quem tem só o
// escopo de escrita não ganha a leitura (para ela, GET /conversations/{id}).
export const handoffResultSchema = z.strictObject({
  conversation_id: z.string(),
  status: z.literal("human").describe("Quem conduz a conversa depois do pedido."),
  changed: z.boolean().describe("false = a conversa já estava com um humano; este pedido não gravou nada."),
  ticket_id: z
    .string()
    .nullable()
    .describe("O ticket em cuja trilha o pedido entrou (o informado ou o em foco); null se não houve, ou se nada mudou."),
  note_id: z.string().nullable().describe("A nota interna deixada no chat; null se nada mudou."),
});

export const activeTicketResultSchema = z.strictObject({
  conversation_id: z.string(),
  active_ticket_id: z.string().nullable().describe("O ticket em foco depois do pedido; null = sem foco."),
  changed: z.boolean().describe("false = o foco já era este."),
});
