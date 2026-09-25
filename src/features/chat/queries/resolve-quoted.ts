import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

export type ResolvedQuote =
  | { ok: true; externalId: string | null }
  | { ok: false };

/**
 * Traduz o id da NOSSA mensagem citada para o id do provedor (`external_id`),
 * que é o que a uazapi entende no campo `replyid`.
 *
 * Confinado à mesma conversa de propósito: sem o `conversation_id` no filtro,
 * um id vindo do cliente permitiria citar mensagem de outro contato.
 *
 * `externalId` pode voltar null legitimamente — mensagem nossa ainda sem eco do
 * provedor, ou anotação interna. Aí a citação vale só no CRM: gravamos o
 * `quoted_message_id` e o contato recebe a mensagem sem o bloco.
 */
export async function resolveQuotedExternalId(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  quotedMessageId: string | null | undefined
): Promise<ResolvedQuote> {
  if (!quotedMessageId) return { ok: true, externalId: null };

  const { data } = await supabase
    .from("chat_messages")
    .select("id, external_id")
    .eq("id", quotedMessageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (!data) return { ok: false };
  return { ok: true, externalId: data.external_id };
}
