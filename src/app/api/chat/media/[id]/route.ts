import { NextResponse } from "next/server";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { CHAT_MEDIA_BUCKET, signStorageObject } from "@/lib/storage/chat-media";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vida da URL assinada, e quanto o navegador reaproveita o redirect. */
const SIGNED_TTL_SECONDS = 600;
const REDIRECT_CACHE_SECONDS = 300;

/**
 * Mídia de uma mensagem do chat: confere a sessão e redireciona (302) para
 * uma URL assinada de vida curta do bucket privado.
 *
 * Redirect, não proxy dos bytes: `<audio>`/`<video>` pedem por Range, e o
 * storage-api já responde isso. Quem pode ver a conversa pode ver a mídia —
 * a regra é a mesma da policy do chat (admin e member ativos).
 *
 * `?variant=thumb` serve a miniatura (`metadata.thumbKey`). Mensagem apagada
 * não tem `media_key` (o trigger de scrub zera), então cai no 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Mídia inválida." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: message, error } = await supabase
    .from("chat_messages")
    .select("media_bucket, media_key, metadata")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/chat/media/[id]]", error.message);
    return NextResponse.json({ error: "Falha ao ler a mídia." }, { status: 500 });
  }

  const thumb = new URL(request.url).searchParams.get("variant") === "thumb";
  const metadata =
    message?.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? message.metadata
      : {};
  const key = thumb
    ? typeof metadata.thumbKey === "string"
      ? metadata.thumbKey
      : null
    : message?.media_key ?? null;

  // O bucket vem da própria linha, mas a rota só assina o do chat: um valor
  // estranho gravado por engano não vira acesso a outro bucket.
  if (!message || !key || message.media_bucket !== CHAT_MEDIA_BUCKET) {
    return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
  }

  const signed = await signStorageObject(supabase, CHAT_MEDIA_BUCKET, key, SIGNED_TTL_SECONDS);
  if (!signed) {
    return NextResponse.json({ error: "Mídia indisponível." }, { status: 502 });
  }

  const response = NextResponse.redirect(signed, 302);
  response.headers.set("Cache-Control", `private, max-age=${REDIRECT_CACHE_SECONDS}`);
  return response;
}
