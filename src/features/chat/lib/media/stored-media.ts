import { chatMediaPath } from "@/lib/storage/chat-media";
import type { StoredMedia } from "@/lib/storage/put-media";
import type { Json } from "@/lib/supabase/types";

/**
 * Colunas de uma mensagem cuja mídia está no bucket privado.
 *
 * `media_url` é a rota do app, não o storage: a bolha usa como `src`, e a rota
 * troca por uma URL assinada depois de conferir a sessão. Por isso o id da
 * mensagem precisa existir antes do INSERT (quem grava gera o UUID).
 */
export function storedMediaColumns(messageId: string, stored: StoredMedia) {
  return {
    media_bucket: stored.bucket,
    media_key: stored.key,
    media_url: chatMediaPath(messageId),
  };
}

/**
 * O que da mídia guardada precisa virar `metadata` da mensagem.
 *
 * `thumbKey`/`thumbUrl` porque a miniatura é um objeto de verdade, gerado na
 * entrada, e a bolha precisa saber o endereço. `mediaWidth`/`mediaHeight`
 * porque sem eles a foto remede a linha ao carregar e a conversa salta debaixo
 * do dedo (o WebKit não tem scroll anchoring).
 *
 * Devolve `null` quando não há nada a acrescentar — aí o `metadata` nem é
 * tocado.
 */
export function storedMediaMetadata(
  messageId: string,
  stored: StoredMedia
): Record<string, Json> | null {
  const meta: Record<string, Json> = {};
  if (stored.thumbKey) {
    meta.thumbKey = stored.thumbKey;
    meta.thumbUrl = chatMediaPath(messageId, "thumb");
  }
  if (stored.width && stored.height) {
    meta.mediaWidth = stored.width;
    meta.mediaHeight = stored.height;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}
