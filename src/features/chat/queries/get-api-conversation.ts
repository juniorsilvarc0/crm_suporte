import type { SupabaseClient } from "@supabase/supabase-js";

import { olderThanFilter, takePage, type MessageCursor } from "@/features/chat/lib/messages-page";
import {
  CONVERSATION_DETAIL_SELECT,
  CONVERSATION_MESSAGE_SELECT,
  toApiConversationDetail,
  toApiConversationMessage,
  type ApiConversationDetail,
  type ApiConversationMessage,
} from "@/lib/api/v1/conversations";
import { encodeMessageCursor } from "@/lib/api/v1/cursor";
import type { Database } from "@/lib/supabase/types";

// A conversa e as mensagens dela como a API v1 as entrega (GET
// /conversations/{id}, /messages, e o retorno das escritas, relido depois da
// RPC). Só LÊ: não zera as não lidas nem mexe no foco.

type Admin = SupabaseClient<Database>;

/**
 * `null` = não existe. LANÇA em erro de leitura e em linha fora do tipo: quem
 * chama responde 503, nunca "não encontrada".
 */
export async function getApiConversation(supabase: Admin, id: string): Promise<ApiConversationDetail | null> {
  const { data, error } = await supabase
    .from("chat_conversations")
    .select(CONVERSATION_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`chat_conversations: ${error.message}`);
  if (!data) return null;

  const conversation = toApiConversationDetail(data);
  if (!conversation) throw new Error(`chat_conversations: linha inesperada ${data.id}`);
  return conversation;
}

/**
 * A conversa existe? Para a lista de mensagens: página vazia não diz se a
 * conversa existe, e esta leitura separa o 404. LANÇA em erro de leitura.
 */
export async function conversationExists(supabase: Admin, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("chat_conversations").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`chat_conversations: ${error.message}`);
  return data !== null;
}

export type ApiMessagePage = { items: ApiConversationMessage[]; nextCursor: string | null };

/**
 * Uma página de mensagens, da mais NOVA para a mais antiga. `notes` decide se a
 * nota interna entra: ela é do time, e a rota só a pede para quem tem o escopo
 * (o corte é na consulta, para não furar a paginação). LANÇA em erro de
 * leitura e em linha fora do tipo.
 */
export async function getApiConversationMessages(
  supabase: Admin,
  conversationId: string,
  options: { before?: MessageCursor; limit: number; notes: boolean }
): Promise<ApiMessagePage> {
  let query = supabase
    .from("chat_messages")
    .select(CONVERSATION_MESSAGE_SELECT)
    .eq("conversation_id", conversationId);
  if (!options.notes) query = query.neq("type", "note");
  if (options.before) query = query.or(olderThanFilter(options.before));

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // Uma a mais: diz se há página seguinte sem um count.
    .limit(options.limit + 1);
  if (error) throw new Error(`chat_messages: ${error.message}`);

  const { page, hasMore } = takePage(data ?? [], options.limit);
  const items: ApiConversationMessage[] = [];
  for (const row of page) {
    const message = toApiConversationMessage(row);
    if (!message) throw new Error(`chat_messages: linha inesperada ${row.id}`);
    items.push(message);
  }

  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeMessageCursor(last) : null };
}
