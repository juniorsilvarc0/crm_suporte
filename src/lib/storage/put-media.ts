import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildMediaKey, extFromMime, thumbKeyFor } from "@/lib/storage/media-key";
import { isR2Configured, putToR2 } from "@/lib/storage/r2";
import { compressAudio } from "@/features/chat/lib/media/compress-audio";
import { compressImage } from "@/features/chat/lib/media/compress-image";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type StoredMedia = {
  url: string;
  /** Miniatura da imagem, quando faz sentido gerar uma. */
  thumbUrl: string | null;
  /** Dimensões do arquivo guardado — o `<img>` usa para reservar altura. */
  width: number | null;
  height: number | null;
};

/**
 * Guarda um arquivo e devolve a URL pública. **Porta única** de gravação de
 * mídia: webhook, envio de anexo, envio de áudio e foto de perfil passam aqui.
 *
 * Ordem: comprime → tenta R2 → cai no Supabase se o R2 não estiver configurado
 * ou recusar. Mídia antiga não é tocada: `media_url` é URL absoluta, então
 * mensagem velha segue apontando para o Supabase e mensagem nova para o R2,
 * sem tradução no meio.
 *
 * ⚠️ **Vídeo não é transcodificado aqui.** O webhook precisa responder rápido, e
 * reencodar vídeo leva segundos. O envio de anexo já comprime antes de chamar
 * (`compress-video.ts`); o vídeo que ENTRA fica como veio. São 18 arquivos, e
 * no R2 os primeiros 10 GB são gratuitos — não vale arriscar o webhook por isso.
 */
export async function putMedia(opts: {
  supabase: Admin;
  /** Pasta lógica: `chat` ou `avatars`. Não identifica a pessoa (ver media-key). */
  folder: string;
  body: Buffer;
  mime: string;
}): Promise<StoredMedia | null> {
  const { supabase, folder, mime } = opts;

  let body = opts.body;
  let contentType = mime;
  let ext = extFromMime(mime);
  let thumb: Buffer | null = null;
  let width: number | null = null;
  let height: number | null = null;

  if (mime.startsWith("image/")) {
    const compressed = await compressImage(body, mime);
    body = compressed.full.body;
    contentType = compressed.full.contentType;
    ext = compressed.full.ext;
    thumb = compressed.thumb?.body ?? null;
    width = compressed.width;
    height = compressed.height;
  } else if (mime.startsWith("audio/")) {
    const smaller = await compressAudio(body);
    if (smaller) {
      body = smaller;
      contentType = "audio/mpeg";
      ext = "mp3";
    }
  }

  const key = buildMediaKey(folder, ext);

  if (isR2Configured()) {
    const url = await putToR2(key, body, contentType);
    if (url) {
      // A miniatura é acessório: se ela falhar, a foto ainda aparece — só volta
      // a custar a decodificação do arquivo cheio.
      const thumbUrl = thumb
        ? await putToR2(thumbKeyFor(key), thumb, "image/webp")
        : null;
      return { url, thumbUrl, width, height };
    }
  }

  return putToSupabase({ supabase, key, body, contentType, thumb, width, height });
}

/**
 * Caminho de sempre, agora como reserva.
 *
 * Vale enquanto as credenciais do R2 não existirem no ambiente — subir o código
 * antes das chaves não pode quebrar o recebimento de mídia — e como rede de
 * segurança se a Cloudflare recusar uma subida.
 */
async function putToSupabase(args: {
  supabase: Admin;
  key: string;
  body: Buffer;
  contentType: string;
  thumb: Buffer | null;
  width: number | null;
  height: number | null;
}): Promise<StoredMedia | null> {
  const { supabase, key, body, contentType, thumb, width, height } = args;

  const { error } = await supabase.storage
    .from("chat-media")
    .upload(key, body, { contentType, upsert: true });
  if (error) {
    console.error("[putMedia] Supabase recusou:", error);
    return null;
  }

  const { data } = supabase.storage.from("chat-media").getPublicUrl(key);

  let thumbUrl: string | null = null;
  if (thumb) {
    const thumbPath = thumbKeyFor(key);
    const { error: thumbErr } = await supabase.storage
      .from("chat-media")
      .upload(thumbPath, thumb, { contentType: "image/webp", upsert: true });
    if (!thumbErr) {
      thumbUrl = supabase.storage.from("chat-media").getPublicUrl(thumbPath).data.publicUrl;
    }
  }

  return { url: data.publicUrl, thumbUrl, width, height };
}
