import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Mídia do chat: bucket PRIVADO (20260925120500_storage_realtime.sql).
 *
 * Nenhuma URL de storage vai para o banco nem para o navegador. A linha guarda
 * `media_bucket` + `media_key`, e `media_url` aponta para a rota do próprio
 * app (`/api/chat/media/<id>`), que confere a sessão e redireciona para uma
 * URL assinada de vida curta. Assim os componentes do chat seguem usando
 * `media_url` como `src`, e a foto do cliente deixa de ser pública para
 * sempre para quem tiver o link.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const CHAT_MEDIA_BUCKET = "chat-media";

/** `file_size_limit` do bucket (e `FILE_SIZE_LIMIT` do storage-api). */
export const CHAT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

/**
 * `allowed_mime_types` do bucket. O storage-api compara `tipo/subtipo`
 * literal, e o teste `chat-media.test.ts` falha se esta lista divergir da
 * migration.
 */
export const CHAT_MEDIA_ALLOWED_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
  "video/webm",
  "video/mpeg",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/amr",
  "audio/webm",
  "audio/wav",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/rtf",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/octet-stream",
]);

/**
 * Tipo com que o objeto é gravado.
 *
 * Tira os parâmetros (`audio/ogg; codecs=opus` → `audio/ogg`), senão o bucket
 * recusa. Fora da lista vira `application/octet-stream`: é o que faz o
 * navegador BAIXAR um HTML/SVG em vez de executá-lo. O tipo real continua em
 * `chat_messages.media_mime_type`.
 */
export function storageContentType(mime: string | null | undefined): string {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return CHAT_MEDIA_ALLOWED_MIME.has(base) ? base : "application/octet-stream";
}

/** `media_url` de uma mensagem com mídia no bucket. */
export function chatMediaPath(messageId: string, variant?: "thumb"): string {
  return `/api/chat/media/${messageId}${variant ? `?variant=${variant}` : ""}`;
}

/**
 * `contact_avatar_url` da conversa. `v` muda quando a foto muda: o endereço
 * é o mesmo para o contato inteiro, e sem ele o navegador mostraria a foto
 * antiga do cache.
 */
export function contactAvatarPath(contactId: string, version: string): string {
  return `/api/contacts/${contactId}/avatar?v=${encodeURIComponent(version)}`;
}

/**
 * URL assinada de um objeto, ou null se o storage recusar.
 *
 * O servidor fala com o Supabase pela URL interna (`SUPABASE_URL`, que dentro
 * do Docker é `host.docker.internal`), e o supabase-js monta a URL assinada
 * com ela. Quem abre a URL é o navegador ou a uazapi, que só alcançam a
 * pública (`NEXT_PUBLIC_SUPABASE_URL`): o prefixo é trocado.
 */
export async function signStorageObject(
  supabase: Admin,
  bucket: string,
  key: string,
  expiresInSeconds: number
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(key, expiresInSeconds);
  if (error || !data?.signedUrl) {
    console.error("[storage] assinar URL falhou:", error?.message ?? "sem URL");
    return null;
  }
  return toPublicOrigin(data.signedUrl);
}

/** Troca o prefixo interno do Supabase pelo público. Exportada para teste. */
export function toPublicOrigin(
  signedUrl: string,
  internalBase = process.env.SUPABASE_URL,
  publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL
): string {
  if (!internalBase || !publicBase) return signedUrl;
  const from = internalBase.replace(/\/+$/, "");
  const to = publicBase.replace(/\/+$/, "");
  return signedUrl.startsWith(`${from}/`) ? `${to}${signedUrl.slice(from.length)}` : signedUrl;
}
