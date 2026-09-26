import type { NormalizedMessage } from "@/features/chat/lib/normalizers/types";
import { buildMessageLinkPreview } from "@/features/chat/lib/message-content";
import type { MessageType } from "@/features/chat/types";
import { cleanContactName } from "@/lib/formatters/clean-name";

// Normalização do webhook de entrada da uazapi (FORMATO REAL confirmado contra a
// instância `spincode.uazapi.com`).
//
// Envelope:
//   { EventType: "messages" | "messages_update",
//     message: {...},        // presente em "messages"
//     event: {...},          // presente em "messages_update" (status/mídia)
//     chat: {...},           // metadados do chat (avatar, lead fields)
//     owner, instanceName, token, type, state }
//
// "messages"        → mensagem nova (inbound ou fromMe). A conversa é chaveada
//                     pelo `chatid` (o CONTRAPARTE), nunca pelo sender.
// "messages_update" → event.Type ∈ {Delivered, Read, Played, Sent, Error,
//                     FileDownloaded}. FileDownloaded traz FileURL+MimeType da
//                     mídia (áudio/imagem chegam DEPOIS da msg, por este evento).
//                     Casa por event.MessageIDs[] (= external_id da mensagem).

export type RawUazapiMessage = {
  id?: string;
  messageid?: string;
  chatid?: string;
  sender?: string;
  sender_pn?: string;
  senderName?: string;
  pushName?: string;
  isGroup?: boolean;
  fromMe?: boolean;
  messageType?: string;
  type?: string;
  messageTimestamp?: number;
  timestamp?: number;
  text?: string;
  caption?: string;
  content?: unknown;
  sendPayload?: unknown;
  fileURL?: string;
  mediaUrl?: string;
  mimetype?: string;
  mediaType?: string;
  track_id?: string;
  track_source?: string;
  // Citação. O SKILL.md não documenta a chave, e a uazapi já variou entre
  // repassar o contextInfo cru do Baileys e um objeto `quoted` próprio — por
  // isso `extractUazapiQuotedId` aceita as formas conhecidas e devolve null
  // quando não reconhece. Sem citação a mensagem entra normal, só sem o bloco.
  quoted?: unknown;
  replyid?: unknown;
  contextInfo?: unknown;
};

/** Primeiro id de mensagem plausível dentro de um objeto de citação. */
function quotedIdFrom(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["messageid", "messageId", "id", "stanzaId", "stanzaID"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Id do provedor da mensagem que está sendo respondida, ou null.
 *
 * Tolerante de propósito: é payload de terceiro que não controlamos e cuja
 * forma exata não está documentada no nosso SKILL.md.
 */
export function extractUazapiQuotedId(msg: RawUazapiMessage | null): string | null {
  if (!msg) return null;

  const direct = quotedIdFrom(msg.quoted) ?? quotedIdFrom(msg.replyid);
  if (direct) return direct;

  const fromContext = quotedIdFrom(msg.contextInfo);
  if (fromContext) return fromContext;

  // `content` pode ser o objeto cru do Baileys, com contextInfo aninhado.
  const content = msg.content;
  if (content && typeof content === "object") {
    const nested = (content as Record<string, unknown>).contextInfo;
    return quotedIdFrom(nested);
  }

  return null;
}

export type RawUazapiEvent = {
  Type?: string;
  MessageIDs?: string[];
  Chat?: string;
  chatid?: string;
  IsFromMe?: boolean;
  IsGroup?: boolean;
  Sender?: string;
  sender_pn?: string;
  FileURL?: string;
  MimeType?: string;
  Timestamp?: string | number;
};

export type UazapiEnvelope = {
  EventType?: string;
  event?: RawUazapiEvent;
  message?: RawUazapiMessage;
  data?: RawUazapiMessage;
  chat?: { image?: string; imagePreview?: string; name?: string };
  owner?: string;
};

export function uazapiEventType(payload: UazapiEnvelope): string {
  return (payload.EventType ?? "").toString();
}

export function getUazapiMessage(payload: UazapiEnvelope): RawUazapiMessage | null {
  if (payload.message && typeof payload.message === "object") return payload.message;
  if (payload.data && typeof payload.data === "object") return payload.data;
  return null;
}

/** Só os dígitos do telefone a partir de um JID ("5511...@s.whatsapp.net"). */
function jidToPhone(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const digits = jid.replace(/@.+$/, "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function isGroupJid(jid: string | undefined | null): boolean {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

/** Tipos cuja bolha ocupa área na tela e por isso precisa reservar altura. */
const VISUAL_TYPES = new Set<MessageType>(["image", "sticker", "video"]);

function mapType(raw: string | undefined): MessageType {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("image")) return "image";
  if (t.includes("sticker")) return "sticker";
  if (t.includes("audio") || t.includes("ptt") || t.includes("voice")) return "audio";
  if (t.includes("ptv") || t.includes("video")) return "video";
  if (t.includes("document")) return "document";
  if (t.includes("contact") || t.includes("vcard")) return "contact";
  return "text";
}

function extractContent(m: RawUazapiMessage): string | null {
  if (typeof m.text === "string" && m.text) return m.text;
  if (typeof m.caption === "string" && m.caption) return m.caption;
  if (m.content && typeof m.content === "object") {
    const c = m.content as Record<string, unknown>;
    for (const k of ["text", "caption", "body", "conversation"]) {
      if (typeof c[k] === "string" && c[k]) return c[k] as string;
    }
  }
  return null;
}

/**
 * Dimensões originais da mídia, quando a uazapi as manda (`content.width` /
 * `content.height` — confirmado no payload de produção).
 *
 * Servem para o `<img>` reservar a altura antes de carregar. Sem elas, cada
 * foto que termina de baixar remede a linha e a conversa salta debaixo do dedo.
 * Ausente é ausente: não se estima proporção.
 */
function extractMediaSize(
  m: RawUazapiMessage
): { mediaWidth: number; mediaHeight: number } | null {
  if (!m.content || typeof m.content !== "object") return null;
  const { width, height } = m.content as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { mediaWidth: width, mediaHeight: height };
}

function toIso(ts: number | undefined): string {
  if (!ts || ts <= 0) return new Date().toISOString();
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Normaliza uma mensagem ("messages"). A conversa é SEMPRE chaveada pelo
 * `chatid` (o contraparte), tanto p/ inbound quanto p/ fromMe — assim uma
 * mensagem que o dono envia do próprio celular vai para a conversa do contato,
 * e não para uma conversa com o número do dono.
 */
export function normalizeUazapiWebhook(
  payload: UazapiEnvelope
): NormalizedMessage | null {
  const event = uazapiEventType(payload);
  if (event && event !== "messages" && event !== "message") return null;

  const m = getUazapiMessage(payload);
  if (!m) return null;

  const chatJid = m.chatid ?? "";
  if (m.isGroup === true || isGroupJid(chatJid)) return null; // grupos fora do escopo

  // chatid é o contraparte; fallback p/ sender_pn (inbound) e sender.
  const phone = jidToPhone(m.chatid) ?? jidToPhone(m.sender_pn) ?? jidToPhone(m.sender);
  if (!phone) return null;

  const externalId = m.messageid ?? m.id;
  if (!externalId) return null;

  const avatar = payload.chat?.imagePreview ?? payload.chat?.image ?? null;
  const content = extractContent(m);
  const linkPreview = buildMessageLinkPreview(
    content,
    m.content ?? m.sendPayload
  );
  const type = mapType(m.messageType ?? m.type ?? m.mediaType);
  // Só tipo visual: documento e áudio não têm o que reservar na tela.
  const mediaSize = VISUAL_TYPES.has(type) ? extractMediaSize(m) : null;
  const metadata = {
    ...(linkPreview ? { linkPreview } : {}),
    ...(mediaSize ?? {}),
  };

  return {
    external_id: externalId,
    direction: m.fromMe ? "outbound" : "inbound",
    type,
    content,
    media_url: m.fileURL ?? m.mediaUrl ?? null,
    media_mime_type: m.mimetype ?? null,
    // Em fromMe o senderName é o DONO, não o contato — não usar como nome.
    // Limpa emojis/til do pushname para nome de contato/lead.
    contact_name: m.fromMe ? null : cleanContactName(m.senderName ?? m.pushName),
    contact_phone: phone,
    contact_avatar_url: avatar,
    quoted_external_id: extractUazapiQuotedId(m),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    created_at: toIso(m.messageTimestamp ?? m.timestamp),
  };
}

export type UazapiStatusUpdate = {
  messageid: string;
  status: "sent" | "delivered" | "read" | "failed";
};

/** Mapeia event.Type ("messages_update") para o nosso delivery_status. */
function mapEventType(type: string | undefined): UazapiStatusUpdate["status"] | null {
  const t = (type ?? "").toLowerCase();
  if (t.includes("error") || t.includes("fail")) return "failed";
  if (t.includes("read") || t.includes("played")) return "read";
  if (t.includes("deliver")) return "delivered";
  if (t.includes("sent") || t.includes("server")) return "sent";
  return null; // Ex.: "FileDownloaded" não é status (tratado à parte)
}

/** Extrai as atualizações de status de um evento "messages_update". */
export function extractUazapiStatuses(payload: UazapiEnvelope): UazapiStatusUpdate[] {
  if (uazapiEventType(payload) !== "messages_update") return [];
  const evt = payload.event;
  if (!evt) return [];
  const status = mapEventType(evt.Type);
  if (!status) return [];
  const ids = Array.isArray(evt.MessageIDs) ? evt.MessageIDs : [];
  return ids
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .map((id) => ({ messageid: id, status }));
}

/**
 * Ids das mensagens apagadas num "messages_update", ou null.
 *
 * A uazapi emite `Type: "Deleted"` tanto quando NÓS chamamos `/message/delete`
 * quanto quando o contato apaga do celular dele. Sem tratar isto, a mensagem
 * que o contato apagou continua na nossa tela — `mapEventType` devolve null
 * para "Deleted" e o evento era engolido em silêncio.
 */
export function extractUazapiDeletion(payload: UazapiEnvelope): string[] | null {
  if (uazapiEventType(payload) !== "messages_update") return null;
  const evt = payload.event;
  if (!evt) return null;
  if ((evt.Type ?? "").toLowerCase() !== "deleted") return null;
  const ids = Array.isArray(evt.MessageIDs)
    ? evt.MessageIDs.filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    : [];
  return ids.length > 0 ? ids : null;
}

export type UazapiMediaUpdate = {
  messageIds: string[];
  fileUrl: string;
  mimetype: string | null;
  phone: string | null;
  isGroup: boolean;
};

/**
 * Extrai a mídia baixada de um "messages_update" com Type "FileDownloaded"
 * (áudio/imagem/documento chegam por aqui, depois da mensagem).
 */
export function extractUazapiMedia(payload: UazapiEnvelope): UazapiMediaUpdate | null {
  if (uazapiEventType(payload) !== "messages_update") return null;
  const evt = payload.event;
  if (!evt || !evt.FileURL) return null;
  if ((evt.Type ?? "").toLowerCase() !== "filedownloaded") return null;
  const ids = Array.isArray(evt.MessageIDs) ? evt.MessageIDs.filter(Boolean) : [];
  if (ids.length === 0) return null;
  return {
    messageIds: ids as string[],
    fileUrl: evt.FileURL,
    mimetype: evt.MimeType ?? null,
    phone: jidToPhone(evt.chatid) ?? jidToPhone(evt.Chat),
    isGroup: evt.IsGroup === true || isGroupJid(evt.chatid) || isGroupJid(evt.Chat),
  };
}
