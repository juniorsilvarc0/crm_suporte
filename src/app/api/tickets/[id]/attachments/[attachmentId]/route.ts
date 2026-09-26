import { NextResponse } from "next/server";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import {
  TICKET_ATTACHMENTS_BUCKET,
  signTicketAttachment,
} from "@/lib/storage/ticket-attachments";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "[GET /api/tickets/[id]/attachments/[attachmentId]]";

/** Vida da URL assinada, e quanto o navegador reaproveita o redirect (molde: api/chat/media). */
const SIGNED_TTL_SECONDS = 600;
const REDIRECT_CACHE_SECONDS = 300;

/**
 * Arquivo de um anexo do ticket: confere a sessão e redireciona (302) para uma
 * URL assinada de vida curta do bucket privado, no molde de /api/chat/media.
 *
 * O anexo é buscado pelo par (ticket, anexo): o de outro ticket é 404, como o
 * inexistente. Quem vê o ticket vê o anexo (admin e member ativos). O que não é
 * imagem, vídeo, áudio nem PDF sai como download com o nome original (ver
 * signTicketAttachment).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id, attachmentId } = await params;
  if (!isUuid(id) || !isUuid(attachmentId)) {
    return NextResponse.json({ ok: false, message: "Anexo inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: attachment, error } = await supabase
    .from("ticket_attachments")
    .select("bucket, object_key, file_name, mime")
    .eq("id", attachmentId)
    .eq("ticket_id", id)
    .maybeSingle();

  if (error) {
    console.error(ROUTE, error.code, error.message);
    return NextResponse.json({ ok: false, message: "Falha ao ler o anexo." }, { status: 500 });
  }

  // O bucket vem da própria linha (e o CHECK o fixa), mas a rota só assina o
  // dos anexos: um valor estranho não vira acesso a outro bucket.
  if (!attachment || attachment.bucket !== TICKET_ATTACHMENTS_BUCKET) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Anexo não encontrado." },
      { status: 404 }
    );
  }

  const signed = await signTicketAttachment(supabase, attachment, SIGNED_TTL_SECONDS);
  if (!signed) {
    return NextResponse.json({ ok: false, message: "Anexo indisponível." }, { status: 502 });
  }

  const response = NextResponse.redirect(signed, 302);
  response.headers.set("Cache-Control", `private, max-age=${REDIRECT_CACHE_SECONDS}`);
  return response;
}
