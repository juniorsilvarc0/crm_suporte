import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
} from "@/features/chat/types";
import {
  buildTicketTimeline,
  isTimelineInstant,
  TIMELINE_PAGE_SIZE,
  type TimelineSource,
} from "@/features/tickets/lib/ticket-timeline";
import { isTicketStatus } from "@/features/tickets/lib/ticket-status";
import type {
  TicketActorType,
  TicketMessageSender,
  TicketTimelinePage,
  TimelineAttachmentItem,
  TimelineCommentItem,
  TimelineEventItem,
  TimelineItem,
  TimelineMessageItem,
  TimelineStatusItem,
} from "@/features/tickets/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

// ⚠️ Colunas SEMPRE explícitas. Ficam no servidor: actor_token_id e event_key
// da trilha (o actor_type basta à tela), bucket/object_key/sha256 do anexo (o
// arquivo sai pela rota com URL assinada) e, da mensagem, mídia, external_id e
// o resto do metadata. Deletado não some: comentário apagado vem com body nulo
// e deleted_at, mensagem apagada com is_deleted (o banco já zerou o conteúdo),
// e a tela mostra "apagado" no lugar, como o chat faz.
export const TIMELINE_STATUS_SELECT =
  "id, from_status, to_status, actor_type, actor_user_id, reason, occurred_at, seq";
export const TIMELINE_EVENT_SELECT =
  "id, event_type, actor_type, actor_user_id, metadata, occurred_at, seq";
export const TIMELINE_COMMENT_SELECT =
  "id, author_user_id, author_token_id, body, created_at, edited_at, deleted_at";
export const TIMELINE_MESSAGE_SELECT =
  "id, direction, sender_type, type, content, file_name:metadata->>fileName, delivery_status, sent_by_user_id, is_deleted, created_at";
export const TIMELINE_ATTACHMENT_SELECT =
  "id, file_name, mime, size_bytes, uploaded_by_user_id, uploaded_by_token_id, created_at";

// Limite por fonte na 1ª leitura (a spec: até 100 cada) e na releitura de uma
// fonte que trouxe o limite inteiro no mesmo instante (ver buildTicketTimeline).
const SOURCE_LIMIT = TIMELINE_PAGE_SIZE;
const RETRY_LIMIT = 1000;

// Allowlists com todas as chaves do tipo (o Record obriga): valor fora do CHECK
// do banco derruba a timeline em vez de chegar à tela com um tipo que mente.
const ACTOR_TYPES: Record<TicketActorType, true> = {
  agent: true,
  ai: true,
  api: true,
  system: true,
};
const MESSAGE_DIRECTIONS: Record<MessageDirection, true> = { inbound: true, outbound: true };
const MESSAGE_SENDERS: Record<TicketMessageSender, true> = {
  contact: true,
  agent: true,
  ai: true,
  system: true,
  device: true,
};
const MESSAGE_TYPES: Record<MessageType, true> = {
  text: true,
  image: true,
  audio: true,
  video: true,
  document: true,
  sticker: true,
  contact: true,
  template: true,
  note: true,
};
const DELIVERY_STATUSES: Record<MessageDeliveryStatus, true> = {
  pending: true,
  sent: true,
  delivered: true,
  read: true,
  failed: true,
};

function isKeyOf<T extends string>(allowlist: Record<T, true>, value: unknown): value is T {
  return typeof value === "string" && Object.hasOwn(allowlist, value);
}

function unexpected(source: string, id: string): never {
  throw new Error(`getTicketTimeline: ${source} com valor inesperado (${id})`);
}

type Db = SupabaseClient<Database>;
type Result<Row> = { data: Row[] | null; error: { message: string } | null };

// Uma fonte que falha derruba a timeline inteira (a rota responde 500): uma
// página sem os status, por exemplo, pareceria completa e o cursor seguiria
// adiante sem eles. A mensagem do banco vai só para o log de quem chamou.
function toSource<Row>(
  source: string,
  result: Result<Row>,
  limit: number,
  toItem: (row: Row) => TimelineItem
): TimelineSource {
  if (result.error) throw new Error(`getTicketTimeline ${source} failed: ${result.error.message}`);
  const rows = result.data ?? [];
  return { items: rows.map(toItem), hitLimit: rows.length >= limit };
}

type Reader = (db: Db, ticketId: string, before: string | undefined, limit: number) => Promise<TimelineSource>;

// Trilha: (occurred_at desc, seq desc), o índice *_ticket_idx. Nunca por id:
// a mesma transação grava várias linhas no mesmo instante, e o id é aleatório.
const readStatusHistory: Reader = async (db, ticketId, before, limit) => {
  let query = db
    .from("ticket_status_history")
    .select(TIMELINE_STATUS_SELECT)
    .eq("ticket_id", ticketId);
  if (before) query = query.lt("occurred_at", before);
  const result = await query
    .order("occurred_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(limit);

  return toSource("ticket_status_history", result, limit, (row): TimelineStatusItem => {
    if (
      !isTimelineInstant(row.occurred_at) ||
      !Number.isSafeInteger(row.seq) ||
      !isTicketStatus(row.to_status) ||
      !(row.from_status === null || isTicketStatus(row.from_status)) ||
      !isKeyOf(ACTOR_TYPES, row.actor_type)
    ) {
      return unexpected("ticket_status_history", row.id);
    }
    return {
      kind: "status",
      id: row.id,
      at: row.occurred_at,
      seq: row.seq,
      from_status: row.from_status,
      to_status: row.to_status,
      actor_type: row.actor_type,
      actor_user_id: row.actor_user_id,
      reason: row.reason,
    };
  });
};

const readEvents: Reader = async (db, ticketId, before, limit) => {
  let query = db.from("ticket_events").select(TIMELINE_EVENT_SELECT).eq("ticket_id", ticketId);
  if (before) query = query.lt("occurred_at", before);
  const result = await query
    .order("occurred_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(limit);

  return toSource("ticket_events", result, limit, (row): TimelineEventItem => {
    const metadata: unknown = row.metadata;
    if (
      !isTimelineInstant(row.occurred_at) ||
      !Number.isSafeInteger(row.seq) ||
      !isKeyOf(ACTOR_TYPES, row.actor_type) ||
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      return unexpected("ticket_events", row.id);
    }
    return {
      kind: "event",
      id: row.id,
      at: row.occurred_at,
      seq: row.seq,
      event_type: row.event_type,
      actor_type: row.actor_type,
      actor_user_id: row.actor_user_id,
      metadata: { ...metadata },
    };
  });
};

// Comentário, mensagem e anexo: (created_at desc, id desc), o índice de cada um.
const readComments: Reader = async (db, ticketId, before, limit) => {
  let query = db.from("ticket_comments").select(TIMELINE_COMMENT_SELECT).eq("ticket_id", ticketId);
  if (before) query = query.lt("created_at", before);
  const result = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  return toSource("ticket_comments", result, limit, (row): TimelineCommentItem => {
    if (!isTimelineInstant(row.created_at)) return unexpected("ticket_comments", row.id);
    return {
      kind: "comment",
      id: row.id,
      at: row.created_at,
      author_user_id: row.author_user_id,
      author_token_id: row.author_token_id,
      body: row.body,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
    };
  });
};

// As mensagens da conversa carimbadas com ESTE ticket (chat_messages.ticket_id),
// notas incluídas ("Nota no chat").
const readMessages: Reader = async (db, ticketId, before, limit) => {
  let query = db.from("chat_messages").select(TIMELINE_MESSAGE_SELECT).eq("ticket_id", ticketId);
  if (before) query = query.lt("created_at", before);
  const result = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  return toSource("chat_messages", result, limit, (row): TimelineMessageItem => {
    if (
      !isTimelineInstant(row.created_at) ||
      !isKeyOf(MESSAGE_DIRECTIONS, row.direction) ||
      !isKeyOf(MESSAGE_SENDERS, row.sender_type) ||
      !isKeyOf(MESSAGE_TYPES, row.type) ||
      !isKeyOf(DELIVERY_STATUSES, row.delivery_status)
    ) {
      return unexpected("chat_messages", row.id);
    }
    const fileName: unknown = row.file_name;
    return {
      kind: "message",
      id: row.id,
      at: row.created_at,
      direction: row.direction,
      sender_type: row.sender_type,
      type: row.type,
      content: row.content,
      file_name: typeof fileName === "string" ? fileName : null,
      delivery_status: row.delivery_status,
      sent_by_user_id: row.sent_by_user_id,
      is_deleted: row.is_deleted,
    };
  });
};

const readAttachments: Reader = async (db, ticketId, before, limit) => {
  let query = db
    .from("ticket_attachments")
    .select(TIMELINE_ATTACHMENT_SELECT)
    .eq("ticket_id", ticketId);
  if (before) query = query.lt("created_at", before);
  const result = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  return toSource("ticket_attachments", result, limit, (row): TimelineAttachmentItem => {
    if (!isTimelineInstant(row.created_at) || !Number.isSafeInteger(row.size_bytes)) {
      return unexpected("ticket_attachments", row.id);
    }
    return {
      kind: "attachment",
      id: row.id,
      at: row.created_at,
      file_name: row.file_name,
      mime: row.mime,
      size_bytes: row.size_bytes,
      uploaded_by_user_id: row.uploaded_by_user_id,
      uploaded_by_token_id: row.uploaded_by_token_id,
    };
  });
};

const READERS: readonly Reader[] = [
  readStatusHistory,
  readEvents,
  readComments,
  readMessages,
  readAttachments,
];

/**
 * Uma página da timeline do ticket, do mais novo para o mais antigo, com os
 * itens estritamente anteriores a `before` (o `nextBefore` da página anterior).
 *
 * As cinco fontes correm juntas, até 100 cada, e buildTicketTimeline decide o
 * corte sem perder item nem separar um instante. Quando uma fonte trouxe as 100
 * no MESMO instante, nenhum instante veio inteiro: só essa fonte é relida, até
 * 1000. Passar disso é bug (ou carga anômala) e falha explicitamente.
 *
 * LANÇA em erro, inclusive `before` fora do formato (a rota confere antes com
 * isTimelineInstant e responde 400): a rota responde 500, e o detalhe trata a
 * falha como "timeline indisponível" daquela seção. Ticket inexistente dá página
 * vazia; conferir a existência é da rota.
 */
export async function getTicketTimeline(
  ticketId: string,
  options: { before?: string } = {}
): Promise<TicketTimelinePage> {
  const { before } = options;
  if (before !== undefined && !isTimelineInstant(before)) {
    throw new RangeError("Cursor da timeline fora do formato.");
  }

  const db = createSupabaseAdminClient();
  const read = (index: number, limit: number) => READERS[index](db, ticketId, before, limit);

  let sources = await Promise.all(READERS.map((_, index) => read(index, SOURCE_LIMIT)));
  let page = buildTicketTimeline(sources);
  if (page) return page;

  sources = await Promise.all(
    sources.map((source, index) => (source.hitLimit ? read(index, RETRY_LIMIT) : source))
  );
  page = buildTicketTimeline(sources);
  if (page) return page;

  throw new Error(`getTicketTimeline: mais de ${RETRY_LIMIT} itens de uma fonte no mesmo instante`);
}
