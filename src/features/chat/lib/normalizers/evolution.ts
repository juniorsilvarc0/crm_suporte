import type { MessageDirection, MessageType } from "@/features/chat/types";
import type { Json } from "@/lib/supabase/types";

type EvolutionWebhookPayload = {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text: string };
      imageMessage?: { caption?: string; mimetype?: string; url?: string };
      audioMessage?: { url?: string; mimetype?: string };
      videoMessage?: { caption?: string; url?: string; mimetype?: string };
      documentMessage?: { title?: string; url?: string; mimetype?: string };
      stickerMessage?: { url?: string; mimetype?: string };
    };
    messageType?: string;
    messageTimestamp: number;
    mediaUrl?: string;
  };
};

export type NormalizedMessage = {
  external_id: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  contact_name: string | null;
  contact_phone: string;
  contact_avatar_url?: string | null;
  /** Id DO PROVEDOR da mensagem citada; resolvido para o nosso id no upsert. */
  quoted_external_id?: string | null;
  /** Metadados visuais opcionais, como o preview de link entregue pelo provedor. */
  metadata?: Json;
  created_at: string;
};

function mapType(msgType: string | undefined): MessageType {
  const map: Record<string, MessageType> = {
    conversation: "text",
    extendedTextMessage: "text",
    imageMessage: "image",
    audioMessage: "audio",
    pttMessage: "audio",
    videoMessage: "video",
    documentMessage: "document",
    stickerMessage: "sticker",
    contactMessage: "contact",
    templateMessage: "template",
  };
  return (msgType && map[msgType]) || "text";
}

export function normalizeEvolutionWebhook(
  payload: EvolutionWebhookPayload
): NormalizedMessage | null {
  if (payload.event !== "messages.upsert") return null;

  const { data } = payload;
  const jid = data.key.remoteJid;
  const phone = jid.replace(/@.+$/, "");
  const msg = data.message ?? {};

  const text =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.title ??
    null;

  const mediaUrl =
    data.mediaUrl ??
    msg.imageMessage?.url ??
    msg.audioMessage?.url ??
    msg.videoMessage?.url ??
    msg.documentMessage?.url ??
    msg.stickerMessage?.url ??
    null;

  const mediaMime =
    msg.imageMessage?.mimetype ??
    msg.audioMessage?.mimetype ??
    msg.videoMessage?.mimetype ??
    msg.documentMessage?.mimetype ??
    msg.stickerMessage?.mimetype ??
    null;

  return {
    external_id: data.key.id,
    direction: data.key.fromMe ? "outbound" : "inbound",
    type: mapType(data.messageType),
    content: text,
    media_url: mediaUrl,
    media_mime_type: mediaMime,
    contact_name: data.pushName ?? null,
    contact_phone: phone,
    created_at: new Date(data.messageTimestamp * 1000).toISOString(),
  };
}
