import { z } from "zod";

import type {
  ConversationStatus,
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
} from "@/features/chat/types";
import type { TicketMessageSender } from "@/features/tickets/types";

// Conversa e mensagem da API v1. Vocabulário dos checks de _chat; o
// `satisfies` amarra cada lista ao tipo do app. Sem mídia por URL: o
// `media_url` do banco é uma rota de SESSÃO (/api/chat/media/<id>), inútil
// para um token.

const CONVERSATION_STATUSES = ["bot", "human", "resolved"] as const satisfies readonly ConversationStatus[];
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
    .describe("contact = o cliente; agent = analista pelo CRM; ai = a IA; device = o celular da empresa, fora do CRM."),
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
