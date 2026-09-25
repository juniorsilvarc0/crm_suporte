import type { MessageDirection, MessageType } from "@/features/chat/types";
import type { Json } from "@/lib/supabase/types";

/** Mensagem de qualquer provedor, já no formato que o `upsertMessage` grava. */
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
