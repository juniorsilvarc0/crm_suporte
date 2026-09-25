import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { persistInboundMedia } from "@/features/chat/lib/media/persist-inbound";
import type { NormalizedMessage } from "@/features/chat/lib/normalizers/types";
import type { Json } from "@/lib/supabase/types";

/**
 * Identidade estável de uma foto de perfil do WhatsApp.
 *
 * A URL vem assinada (`oh`/`oe` mudam a cada payload) mas o caminho é o mesmo
 * enquanto a pessoa não trocar a foto. Comparar por caminho evita re-hospedar
 * a mesma imagem a cada mensagem — e detecta quando a foto realmente mudou.
 */
function avatarKey(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function upsertMessage(
  integrationId: string,
  contactId: string,
  msg: NormalizedMessage
) {
  const supabase = createSupabaseAdminClient();

  const { data: currentConversation, error: currentConversationError } = await supabase
    .from("chat_conversations")
    .select("id, contact_avatar_url, metadata")
    .eq("integration_id", integrationId)
    .eq("external_id", msg.contact_phone)
    .maybeSingle();
  if (currentConversationError) throw currentConversationError;

  // 1. Upsert conversation. contact_name/avatar só entram quando NÃO nulos — no
  //    upsert do supabase, colunas ausentes não são tocadas no conflito, então
  //    uma mensagem fromMe (sem nome do contato) não apaga o nome já gravado.
  // Foto de perfil: a URL do `pps.whatsapp.net` é assinada e EXPIRA — medido em
  // produção, parte das 238 já devolvia 403, e é isso que virava "?" na lista.
  // Re-hospedamos no chat-media, como já é feito com mídia de mensagem, e só
  // quando a foto muda de verdade (comparação por caminho, não pela URL cheia).
  const avatar = await resolveAvatar(supabase, msg, currentConversation);

  const { data: conv, error: convErr } = await supabase
    .from("chat_conversations")
    .upsert(
      {
        integration_id: integrationId,
        contact_id: contactId,
        external_id: msg.contact_phone,
        contact_phone: msg.contact_phone,
        updated_at: new Date().toISOString(),
        ...(msg.contact_name ? { contact_name: msg.contact_name } : {}),
        ...(avatar ? { contact_avatar_url: avatar.url, metadata: avatar.metadata } : {}),
      },
      { onConflict: "integration_id,external_id" }
    )
    .select("id, contact_id, status, unread_count")
    .single();

  if (convErr || !conv) {
    throw new Error(`Conversation upsert failed: ${convErr?.message}`);
  }

  // 2. Citação: o provedor cita pelo id DELE. Traduz para o nosso, dentro da
  //    mesma conversa. Se a mensagem original não está no banco (chegou antes
  //    da integração, ou é de mídia ainda não gravada), segue sem o bloco —
  //    perder a citação é melhor que perder a mensagem.
  let quotedId: string | null = null;
  if (msg.quoted_external_id) {
    const { data: quoted } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("conversation_id", conv.id)
      .eq("external_id", msg.quoted_external_id)
      .maybeSingle();
    quotedId = quoted?.id ?? null;
  }

  // 3. Upsert message. O AFTER INSERT real atualiza prévia, interação,
  //    reativação e unread na mesma transação; retry não dispara o trigger.
  const { error: msgErr } = await supabase.from("chat_messages").upsert(
    {
      conversation_id: conv.id,
      external_id: msg.external_id,
      ...(quotedId ? { quoted_message_id: quotedId } : {}),
      direction: msg.direction,
      // Mensagem nova com fromMe e sem track_id é do celular da empresa, fora
      // do CRM (o eco do que o CRM enviou é conciliado antes, no webhook).
      sender_type: msg.direction === "inbound" ? "contact" : "device",
      type: msg.type,
      content: msg.content,
      media_url: msg.media_url,
      media_mime_type: msg.media_mime_type,
      ...(msg.metadata ? { metadata: msg.metadata } : {}),
      delivery_status:
        msg.direction === "inbound" ? "delivered" : "sent",
      created_at: msg.created_at,
    },
    { onConflict: "conversation_id,external_id", ignoreDuplicates: true }
  );

  if (msgErr) {
    throw new Error(`Message upsert failed: ${msgErr.message}`);
  }

  return conv;
}

type JsonObject = { [key: string]: Json | undefined };
type ResolvedAvatar = { url: string; metadata: JsonObject };

/**
 * Decide o `contact_avatar_url` a gravar.
 *
 * Devolve null quando não há nada a mudar — e aí o upsert nem toca na coluna,
 * preservando a foto que já está lá. Nunca lança: perder a foto não pode
 * derrubar o recebimento da mensagem.
 */
async function resolveAvatar(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  msg: NormalizedMessage,
  current: {
    contact_avatar_url: string | null;
    metadata: Json;
  } | null
): Promise<ResolvedAvatar | null> {
  const source = msg.contact_avatar_url;
  if (!source) return null;

  try {
    const metadata = (current?.metadata ?? {}) as JsonObject;
    const key = avatarKey(source);

    // Mesma foto já hospedada: nada a fazer. É o caminho de 99% das mensagens.
    if (metadata.avatar_key === key && current?.contact_avatar_url) return null;

    const hosted = await persistInboundMedia(supabase, "avatars", source, "image/jpeg");
    // Falhou o download? Guarda a URL original mesmo assim: expira, mas o
    // ContactAvatar cai nas iniciais quando ela morrer.
    return {
      url: hosted?.url ?? source,
      metadata: { ...metadata, ...(hosted ? { avatar_key: key } : {}) },
    };
  } catch (error) {
    console.warn("[upsertMessage] avatar ignorado:", error);
    return null;
  }
}
