import type { NormalizedMessage } from "@/features/chat/lib/normalizers/evolution";
import type { MessageType } from "@/features/chat/types";
import type { MetaWebhookEnvelope } from "@/features/meta/schemas";

export type NormalizedMetaMessage = NormalizedMessage & {
  whatsapp_business_id: string;
  phone_number_id: string | null;
  source_id: string | null;
  source_type: string | null;
  ctwa_clid: string | null;
};

function mapMetaType(type: string): MessageType {
  const map: Record<string, MessageType> = {
    text: "text",
    image: "image",
    audio: "audio",
    voice: "audio",
    video: "video",
    document: "document",
    sticker: "sticker",
    contacts: "contact",
    template: "template",
  };
  return map[type] ?? "text";
}

export function normalizeMetaWebhook(
  payload: MetaWebhookEnvelope
): NormalizedMetaMessage[] {
  const results: NormalizedMetaMessage[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const contacts = value.contacts ?? [];

      for (const message of value.messages ?? []) {
        const contact =
          contacts.find((item) => item.wa_id === message.from) ?? contacts[0];
        const content =
          message.text?.body ??
          message.image?.caption ??
          message.video?.caption ??
          message.document?.filename ??
          null;
        const media =
          message.image ??
          message.audio ??
          message.video ??
          message.document ??
          message.sticker;

        results.push({
          external_id: message.id,
          direction: "inbound",
          type: mapMetaType(message.type),
          content,
          media_url: media ? `meta://media/${media.id}` : null,
          media_mime_type: media?.mime_type ?? null,
          contact_name: contact?.profile?.name ?? null,
          contact_phone: message.from,
          created_at: new Date(Number(message.timestamp) * 1000).toISOString(),
          whatsapp_business_id: entry.id,
          phone_number_id: value.metadata?.phone_number_id ?? null,
          source_id: message.referral?.source_id ?? null,
          source_type: message.referral?.source_type ?? null,
          ctwa_clid: message.referral?.ctwa_clid ?? message.ctwa_clid ?? null,
        });
      }
    }
  }

  return results;
}

export function extractMetaStatuses(payload: MetaWebhookEnvelope) {
  const statuses: Array<{
    external_id: string;
    status: "sent" | "delivered" | "read" | "failed";
  }> = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      for (const status of change.value.statuses ?? []) {
        const mapped =
          status.status === "sent"
            ? "sent"
            : status.status === "delivered"
              ? "delivered"
              : status.status === "read"
                ? "read"
                : status.status === "failed"
                  ? "failed"
                  : null;
        if (mapped) statuses.push({ external_id: status.id, status: mapped });
      }
    }
  }

  return statuses;
}
