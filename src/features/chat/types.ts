export type ConversationStatus = "bot" | "human" | "resolved";
export type MessageDirection = "inbound" | "outbound";
export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "contact"
  | "template"
  | "note";
export type MessageDeliveryStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type ChatIntegration = {
  id: string;
  name: string;
  provider: "evolution" | "uazapi" | "meta";
  config: Record<string, string>;
  phone_number: string | null;
  is_active: boolean;
  created_at: string;
};

/** Etapa do funil oferecida como filtro rápido. Espelho enxuto de `board_columns`. */
export type ChatStageOption = {
  /** `board_columns.key` — o mesmo valor que mora em `leads.status`. */
  key: string;
  label: string;
};

export type ChatConversation = {
  id: string;
  integration_id: string | null;
  lead_id: string;
  /**
   * Etapa do funil do lead (`leads.status`), resolvida no embed da listagem.
   *
   * ⚠️ **Não é coluna de `chat_conversations`.** Vem junto do nome e do telefone,
   * na mesma consulta — a etapa é do LEAD, e duplicá-la aqui no banco criaria
   * duas verdades para a mesma informação. Ausente no payload cru do Realtime,
   * por isso opcional: o merge preserva o valor que já estava na lista.
   */
  lead_status?: string | null;
  external_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_avatar_url: string | null;
  archived_at: string | null;
  removed_at: string | null;
  /** Fixada no topo da lista. `null` = solta. */
  pinned_at: string | null;
  status: ConversationStatus;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  external_id: string | null;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  quoted_message_id: string | null;
  delivery_status: MessageDeliveryStatus;
  sent_by_user_id: string | null;
  is_deleted: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type StatusFilter = "all" | "archived" | ConversationStatus;
