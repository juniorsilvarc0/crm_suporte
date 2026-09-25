import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildMediaKey, extFromMime, thumbKeyFor } from "@/lib/storage/media-key";
import {
  CHAT_MEDIA_BUCKET,
  CHAT_MEDIA_MAX_BYTES,
  storageContentType,
} from "@/lib/storage/chat-media";
import { compressAudio } from "@/features/chat/lib/media/compress-audio";
import { compressImage } from "@/features/chat/lib/media/compress-image";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type StoredMedia = {
  bucket: string;
  key: string;
  /** Miniatura da imagem, quando faz sentido gerar uma. */
  thumbKey: string | null;
  /** Tipo com que o objeto foi gravado (sem parâmetros; ver chat-media). */
  contentType: string;
  /** Dimensões do arquivo guardado — o `<img>` usa para reservar altura. */
  width: number | null;
  height: number | null;
};

/**
 * Guarda um arquivo no bucket privado `chat-media` e devolve onde ele ficou.
 * **Porta única** de gravação de mídia: webhook, envio de anexo, envio de áudio
 * e foto de contato passam aqui.
 *
 * Não devolve URL: o objeto é privado, e quem precisa ler pede uma URL
 * assinada (`signStorageObject`) ou passa pela rota `/api/chat/media/<id>`.
 * O R2 saiu do caminho de gravação: ele servia URL pública permanente.
 *
 * ⚠️ **Vídeo não é transcodificado aqui.** O webhook precisa responder rápido, e
 * reencodar vídeo leva segundos. O envio de anexo já comprime antes de chamar
 * (`compress-video.ts`); o vídeo que ENTRA fica como veio.
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

  // O bucket recusaria de qualquer jeito; recusar aqui dá um log que diz o
  // motivo em vez de um erro genérico do storage.
  if (body.length > CHAT_MEDIA_MAX_BYTES) {
    console.warn(`[putMedia] ${body.length} bytes passa do teto do bucket`);
    return null;
  }

  const stored = storageContentType(contentType);
  const key = buildMediaKey(folder, ext);

  const { error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(key, body, { contentType: stored, upsert: false });
  if (error) {
    console.error("[putMedia] storage recusou:", error.message);
    return null;
  }

  // A miniatura é acessório: se ela falhar, a foto ainda aparece — só volta a
  // custar a decodificação do arquivo cheio.
  let thumbKey: string | null = null;
  if (thumb) {
    const candidate = thumbKeyFor(key);
    const { error: thumbErr } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(candidate, thumb, { contentType: "image/webp", upsert: false });
    if (!thumbErr) thumbKey = candidate;
  }

  return { bucket: CHAT_MEDIA_BUCKET, key, thumbKey, contentType: stored, width, height };
}
