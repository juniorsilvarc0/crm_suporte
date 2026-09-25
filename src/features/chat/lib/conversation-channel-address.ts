type ConversationChannelIdentity = {
  external_id: string | null;
  contact_phone: string | null;
};

/**
 * Endereço que o provedor reconhece para enviar uma mensagem.
 *
 * `external_id` pertence ao canal e não muda quando o perfil canônico da
 * pessoa é editado. O telefone projetado fica como fallback apenas para a
 * janela de rollout em que uma conversa legada ainda não tenha identidade.
 */
export function resolveConversationChannelAddress(
  conversation: ConversationChannelIdentity
): string {
  return conversation.external_id?.trim() || conversation.contact_phone?.trim() || "";
}
