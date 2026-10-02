import { z } from "zod";

import { TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import { isTimelineInstant } from "@/features/tickets/lib/ticket-timeline";
import { ticketCommentSchema } from "@/features/tickets/schemas/comment";
import type { TicketActorType, TicketAttachment, TicketComment, TimelineItem } from "@/features/tickets/types";
import { DELIVERY_STATUSES, DIRECTIONS, MESSAGE_TYPES, SENDERS } from "@/lib/api/v1/conversations";

// O que acontece DENTRO de um ticket, na API v1 (PR 8b): comentário interno,
// anexo e a timeline. DTO campo a campo; do anexo, nunca bucket, object_key
// nem sha256 (o arquivo sai por uma URL assinada curta).

const ACTOR_TYPES = ["agent", "ai", "api", "system"] as const satisfies readonly TicketActorType[];

const commentFields = {
  id: z.string(),
  /** null = apagado (deleted_at preenchido). */
  body: z.string().nullable(),
  author_user_id: z.string().nullable(),
  author_token_id: z.string().nullable(),
  edited_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
};

const attachmentFields = {
  id: z.string(),
  file_name: z.string(),
  mime: z.string(),
  size_bytes: z.number().int(),
  uploaded_by_user_id: z.string().nullable(),
  uploaded_by_token_id: z.string().nullable(),
};

export const commentSchema = z.strictObject({ ...commentFields, created_at: z.string() });
export const attachmentSchema = z.strictObject({ ...attachmentFields, created_at: z.string() });

export const attachmentLinkSchema = z.strictObject({
  url: z.string().describe("URL assinada do arquivo, de vida curta. Não guarde: peça outra quando precisar."),
  expires_at: z.string(),
  file_name: z.string(),
  mime: z.string(),
  size_bytes: z.number().int(),
});

export const timelineItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("status"),
    id: z.string(),
    at: z.string(),
    from_status: z.enum(TICKET_STATUS_KEYS).nullable(),
    to_status: z.enum(TICKET_STATUS_KEYS),
    actor_type: z.enum(ACTOR_TYPES),
    actor_user_id: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("event"),
    id: z.string(),
    at: z.string(),
    event_type: z.string().describe("ticket.<nome> (ex.: ticket.created, ticket.assigned). Lista aberta."),
    actor_type: z.enum(ACTOR_TYPES),
    actor_user_id: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ kind: z.literal("comment"), at: z.string(), ...commentFields }),
  z.strictObject({
    kind: z.literal("message"),
    id: z.string(),
    at: z.string(),
    direction: z.enum(DIRECTIONS),
    sender_type: z.enum(SENDERS),
    type: z.enum(MESSAGE_TYPES).describe("note = nota interna no chat: nunca foi ao cliente."),
    content: z.string().nullable(),
    file_name: z.string().nullable(),
    delivery_status: z.enum(DELIVERY_STATUSES),
    sent_by_user_id: z.string().nullable(),
    sent_by_token_id: z.string().nullable().describe("O token da API que enviou (a IA ou uma integração)."),
    is_deleted: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("attachment"), at: z.string(), ...attachmentFields }),
]);

export type ApiComment = z.infer<typeof commentSchema>;
export type ApiAttachment = z.infer<typeof attachmentSchema>;
export type ApiTimelineItem = z.infer<typeof timelineItemSchema>;

export function toApiComment(comment: TicketComment): ApiComment {
  return {
    id: comment.id,
    body: comment.body,
    author_user_id: comment.author_user_id,
    author_token_id: comment.author_token_id,
    created_at: comment.created_at,
    edited_at: comment.edited_at,
    deleted_at: comment.deleted_at,
  };
}

export function toApiAttachment(attachment: TicketAttachment): ApiAttachment {
  return {
    id: attachment.id,
    file_name: attachment.file_name,
    mime: attachment.mime,
    size_bytes: attachment.size_bytes,
    uploaded_by_user_id: attachment.uploaded_by_user_id,
    uploaded_by_token_id: attachment.uploaded_by_token_id,
    created_at: attachment.created_at,
  };
}

/** Campo a campo, sem o `seq` (ordem interna da trilha, já aplicada na página). */
export function toApiTimelineItem(item: TimelineItem): ApiTimelineItem {
  switch (item.kind) {
    case "status":
      return {
        kind: "status",
        id: item.id,
        at: item.at,
        from_status: item.from_status,
        to_status: item.to_status,
        actor_type: item.actor_type,
        actor_user_id: item.actor_user_id,
        reason: item.reason,
      };
    case "event":
      return {
        kind: "event",
        id: item.id,
        at: item.at,
        event_type: item.event_type,
        actor_type: item.actor_type,
        actor_user_id: item.actor_user_id,
        metadata: { ...item.metadata },
      };
    case "comment":
      return {
        kind: "comment",
        id: item.id,
        at: item.at,
        body: item.body,
        author_user_id: item.author_user_id,
        author_token_id: item.author_token_id,
        edited_at: item.edited_at,
        deleted_at: item.deleted_at,
      };
    case "message":
      return {
        kind: "message",
        id: item.id,
        at: item.at,
        direction: item.direction,
        sender_type: item.sender_type,
        type: item.type,
        content: item.content,
        file_name: item.file_name,
        delivery_status: item.delivery_status,
        sent_by_user_id: item.sent_by_user_id,
        sent_by_token_id: item.sent_by_token_id,
        is_deleted: item.is_deleted,
      };
    case "attachment":
      return {
        kind: "attachment",
        id: item.id,
        at: item.at,
        file_name: item.file_name,
        mime: item.mime,
        size_bytes: item.size_bytes,
        uploaded_by_user_id: item.uploaded_by_user_id,
        uploaded_by_token_id: item.uploaded_by_token_id,
      };
  }
}

// ─── Entradas ────────────────────────────────────────────────────────────────

export const commentBodySchema = z.strictObject(
  { body: ticketCommentSchema.shape.body },
  { error: "Envie um objeto JSON." }
);

// Cursor da timeline: o instante do item mais antigo da página, opaco como os
// outros cursores da v1. Cru por dentro (microssegundo), conferido na volta.
const TIMELINE_CURSOR_VERSION = "t1";

export function encodeTimelineCursor(before: string): string {
  return Buffer.from(`${TIMELINE_CURSOR_VERSION}|${before}`, "utf8").toString("base64url");
}

export function decodeTimelineCursor(value: string): string | null {
  if (value.length === 0 || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const [version, before, ...rest] = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (version !== TIMELINE_CURSOR_VERSION || rest.length > 0 || !before || !isTimelineInstant(before)) return null;
  return before;
}

export const timelineQuerySchema = z.strictObject({
  cursor: z
    .string()
    .transform((value, ctx) => {
      const before = decodeTimelineCursor(value);
      if (!before) {
        ctx.addIssue({ code: "custom", message: "Cursor inválido. Use o next_cursor da página anterior." });
        return z.NEVER;
      }
      return before;
    })
    .optional(),
});
