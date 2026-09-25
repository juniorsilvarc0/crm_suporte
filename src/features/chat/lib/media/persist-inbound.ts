// Re-hospeda mídia recebida. As URLs de mídia da uazapi/WhatsApp
// (mmg.whatsapp.net, ...) são assinadas e EXPIRAM — se só guardarmos a URL
// original, o playback quebra depois. Aqui baixamos (com SSRF guard) e subimos
// para o bucket privado `chat-media` via `putMedia` — este arquivo só cuida de
// baixar com segurança.

import { assertSafeUrl } from "@/features/chat/lib/connection/ssrf-guard";
import { putMedia, type StoredMedia } from "@/lib/storage/put-media";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Baixa `mediaUrl` e re-hospeda. Devolve onde o objeto ficou (mais miniatura e
 * dimensões quando é imagem), ou `null` se falhar — o chamador mantém a URL
 * original.
 *
 * Segurança: `redirect:"error"` (não seguimos 3xx — o guard só valida a URL
 * inicial, então seguir redirect burlaria o SSRF). O header `token` (credencial
 * uazapi) só é enviado quando a mídia está no MESMO host da instância — nunca
 * vaza para um CDN/host arbitrário vindo do payload.
 */
export async function persistInboundMedia(
  supabase: Admin,
  folder: string,
  mediaUrl: string,
  mimeType: string | null,
  opts?: { token?: string; tokenOrigin?: string }
): Promise<StoredMedia | null> {
  try {
    const url = assertSafeUrl(mediaUrl); // exige http(s), bloqueia rede interna

    let sameOrigin = false;
    if (opts?.token && opts.tokenOrigin) {
      try {
        sameOrigin = new URL(opts.tokenOrigin).origin === url.origin;
      } catch {
        sameOrigin = false;
      }
    }
    const headers = opts?.token && sameOrigin ? { token: opts.token } : undefined;

    const res = await fetch(url, {
      headers,
      redirect: "error", // não seguir 3xx (evita SSRF via redirect p/ rede interna)
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    const mime =
      mimeType || res.headers.get("content-type") || "application/octet-stream";

    return await putMedia({ supabase, folder, body: buf, mime });
  } catch (err) {
    console.warn("[persistInboundMedia] mantendo URL original:", err);
    return null;
  }
}
