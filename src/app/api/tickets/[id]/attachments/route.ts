import { NextResponse } from "next/server";

import { mapTicketError } from "@/features/tickets/lib/map-ticket-error";
import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { TIMELINE_ATTACHMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import type { TicketAttachment } from "@/features/tickets/types";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import {
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENTS_BUCKET,
  putTicketAttachment,
  removeTicketAttachment,
  sanitizeAttachmentFileName,
} from "@/lib/storage/ticket-attachments";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[POST /api/tickets/[id]/attachments]";

// Folga do envelope multipart (boundary e cabeçalhos da parte) sobre o teto do
// arquivo, para o Content-Length recusar cedo sem barrar um arquivo de 50 MB.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const TOO_LARGE_MESSAGE = "Arquivo muito grande (máx. 50 MB).";

function fileError(message: string, status: 400 | 413) {
  return NextResponse.json({ ok: false, message, errors: { file: [message] } }, { status });
}

/**
 * Anexa um arquivo ao ticket (multipart, campo `file`, até 50 MB).
 *
 * Ordem: valida → upload → INSERT. Se o INSERT falhar, o objeto é apagado, e
 * nenhum arquivo fica no bucket sem linha. O ticket é conferido ANTES do
 * upload: inexistente → 404 sem tocar no storage.
 *
 * Sem RPC e sem evento na trilha (decisão 14): grant por coluna em
 * `ticket_attachments`, e o autor é sempre quem está na sessão. A migration não
 * barra anexo em ticket encerrado (nem comentário): quem precisa juntar um
 * comprovante depois de fechar consegue.
 *
 * O tipo gravado é o do bucket (storageContentType): HTML, SVG e afins viram
 * `application/octet-stream`, e é esse que vai em `mime`, porque é o que o
 * storage serve. O nome original fica em `file_name`, saneado. A resposta
 * nunca leva bucket, `object_key` nem sha256.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Ticket inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  // Acima de proxyClientMaxBodySize (64 MB) o proxy entrega o corpo cortado, e
  // o multipart viraria "não consegui ler": o 413 sai antes, quando dá.
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > TICKET_ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return fileError(TOO_LARGE_MESSAGE, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fileError("Envie o arquivo como multipart, no campo file.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fileError("Escolha um arquivo.", 400);
  }
  if (file.size === 0) {
    return fileError("O arquivo está vazio.", 400);
  }
  if (file.size > TICKET_ATTACHMENT_MAX_BYTES) {
    return fileError(TOO_LARGE_MESSAGE, 413);
  }

  const supabase = createSupabaseAdminClient();
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (ticketError) {
    console.error(ROUTE, ticketError.code, ticketError.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível anexar o arquivo." },
      { status: 500 }
    );
  }
  if (!ticket) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Ticket não encontrado." },
      { status: 404 }
    );
  }

  // O id do banco, em minúsculas: a chave precisa bater com `ticket_id::text`.
  const stored = await putTicketAttachment({
    supabase,
    ticketId: ticket.id,
    body: Buffer.from(await file.arrayBuffer()),
    mime: file.type,
  });
  if (!stored) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível guardar o arquivo. Tente de novo." },
      { status: 502 }
    );
  }

  const { data: row, error: insertError } = await supabase
    .from("ticket_attachments")
    .insert({
      ticket_id: ticket.id,
      bucket: TICKET_ATTACHMENTS_BUCKET,
      object_key: stored.objectKey,
      file_name: sanitizeAttachmentFileName(file.name),
      mime: stored.mime,
      size_bytes: stored.sizeBytes,
      sha256: stored.sha256,
      uploaded_by_user_id: auth.viewer.id,
    })
    .select(TIMELINE_ATTACHMENT_SELECT)
    .single();

  if (insertError || !row) {
    // Sem linha, o objeto não é de ninguém: apaga antes de responder.
    await removeTicketAttachment(supabase, stored.objectKey);
    return ticketErrorResponse(ROUTE, mapTicketError(insertError), insertError);
  }

  const attachment: TicketAttachment = {
    id: row.id,
    file_name: row.file_name,
    mime: row.mime,
    size_bytes: row.size_bytes,
    uploaded_by_user_id: row.uploaded_by_user_id,
    uploaded_by_token_id: row.uploaded_by_token_id,
    created_at: row.created_at,
  };
  return NextResponse.json({ ok: true, attachment }, { status: 201 });
}
