import { NextResponse } from "next/server";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { CHAT_MEDIA_BUCKET, signStorageObject } from "@/lib/storage/chat-media";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_TTL_SECONDS = 600;
const REDIRECT_CACHE_SECONDS = 300;

/**
 * Foto de perfil do contato (re-hospedada do WhatsApp no bucket privado):
 * confere a sessão e redireciona para uma URL assinada de vida curta.
 *
 * O `?v=` que a conversa guarda em `contact_avatar_url` não é lido aqui: ele
 * só existe para o navegador não reaproveitar o redirect da foto antiga.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Contato inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .select("avatar_bucket, avatar_key")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[GET /api/contacts/[id]/avatar]", error.message);
    return NextResponse.json({ error: "Falha ao ler a foto." }, { status: 500 });
  }
  if (!contact?.avatar_key || contact.avatar_bucket !== CHAT_MEDIA_BUCKET) {
    return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  }

  const signed = await signStorageObject(
    supabase,
    CHAT_MEDIA_BUCKET,
    contact.avatar_key,
    SIGNED_TTL_SECONDS
  );
  if (!signed) {
    return NextResponse.json({ error: "Foto indisponível." }, { status: 502 });
  }

  const response = NextResponse.redirect(signed, 302);
  response.headers.set("Cache-Control", `private, max-age=${REDIRECT_CACHE_SECONDS}`);
  return response;
}
