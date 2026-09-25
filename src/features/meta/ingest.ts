import { normalizePhone } from "@/lib/formatters/phone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import {
  extractMetaStatuses,
  normalizeMetaWebhook,
} from "@/features/chat/lib/normalizers/meta";
import type { MetaWebhookEnvelope } from "@/features/meta/schemas";

function configPhoneNumberId(config: Json): string | null {
  if (!config || Array.isArray(config) || typeof config !== "object") return null;
  const value = config.phoneNumberId ?? config.phone_number_id;
  return typeof value === "string" ? value : null;
}

export async function ingestMetaEnvelope(
  payload: MetaWebhookEnvelope,
  captureEnabled: boolean
) {
  const supabase = createSupabaseAdminClient();
  const messages = normalizeMetaWebhook(payload);
  const statuses = extractMetaStatuses(payload);

  const { data: integrations, error: integrationError } = await supabase
    .from("chat_integrations")
    .select("id, config")
    .eq("provider", "meta")
    .eq("is_active", true);

  if (integrationError) throw new Error("meta_integration_lookup_failed");

  for (const status of statuses) {
    const { error } = await supabase
      .from("chat_messages")
      .update({ delivery_status: status.status })
      .eq("external_id", status.external_id);
    if (error) throw new Error("meta_status_persistence_failed");
  }

  let insertedMessages = 0;
  let attributions = 0;

  for (const message of messages) {
    const integration =
      integrations?.find(
        (item) =>
          configPhoneNumberId(item.config) === message.phone_number_id
      ) ?? integrations?.[0];
    const normalizedPhone = normalizePhone(message.contact_phone);

    const { data, error } = await supabase.rpc("ingest_meta_webhook_message", {
      p_integration_id: integration?.id ?? null,
      p_phone: message.contact_phone,
      p_normalized_phone: normalizedPhone,
      p_contact_name: message.contact_name,
      p_external_id: message.external_id,
      p_message_type: message.type,
      p_content: message.content,
      p_media_url: message.media_url,
      p_media_mime_type: message.media_mime_type,
      p_message_at: message.created_at,
      p_whatsapp_business_id: message.whatsapp_business_id,
      p_phone_number_id: message.phone_number_id,
      p_source_id: captureEnabled ? message.source_id : null,
      p_source_type: captureEnabled ? message.source_type : null,
      p_ctwa_clid: captureEnabled ? message.ctwa_clid : null,
    });

    if (error) throw new Error("meta_message_transaction_failed");

    if (data && typeof data === "object" && !Array.isArray(data)) {
      if (data.messageInserted === true) insertedMessages += 1;
      if (typeof data.attributionId === "string") attributions += 1;
    }
  }

  return {
    messages: messages.length,
    insertedMessages,
    statuses: statuses.length,
    attributions,
  };
}

