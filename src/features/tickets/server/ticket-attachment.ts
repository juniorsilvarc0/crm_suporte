import type { SupabaseClient } from "@supabase/supabase-js";

import { mapTicketError } from "@/features/tickets/lib/map-ticket-error";
import { TIMELINE_ATTACHMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import type { TicketActor } from "@/features/tickets/server/ticket-service";
import type { TicketAttachment, TicketError } from "@/features/tickets/types";
import {
  TICKET_ATTACHMENTS_BUCKET,
  putTicketAttachment,
  removeTicketAttachment,
  sanitizeAttachmentFileName,
} from "@/lib/storage/ticket-attachments";
import type { Database } from "@/lib/supabase/types";

// Anexo do ticket: a tela (sessão) e a API v1 (token) passam por aqui. A rota
// lê e confere o arquivo (multipart, tamanho); daqui para a frente é igual.
//
// Ordem: ticket → upload → INSERT. Se o INSERT falhar, o objeto é apagado, e
// nenhum arquivo fica no bucket sem linha. Ticket inexistente é 404 sem tocar
// no storage. Sem RPC e sem evento (decisão 14): grant por coluna, e o autor
// vem de quem chama. O tipo gravado é o do bucket (storageContentType): HTML,
// SVG e afins viram application/octet-stream. A resposta nunca leva bucket,
// object_key nem sha256.

type DatabaseError = { message: string; code?: string };

/**
 * `read` e não os bytes prontos: a cópia do arquivo (até 50 MB) só acontece
 * DEPOIS de o ticket ser conferido. Ticket inexistente não custa a cópia.
 */
export type AttachmentFile = { name: string; type: string; read: () => Promise<Buffer> };

/** Cada falha com o que a rota precisa para responder e logar com o nome dela. */
export type TicketAttachmentResult =
  | { ok: true; data: TicketAttachment }
  | { ok: false; reason: "read_failed"; cause: DatabaseError }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "storage_failed" }
  | { ok: false; reason: "insert_failed"; error: TicketError; cause: DatabaseError | null };

export async function addTicketAttachment(
  db: SupabaseClient<Database>,
  actor: TicketActor,
  ticketId: string,
  file: AttachmentFile
): Promise<TicketAttachmentResult> {
  const { data: ticket, error: ticketError } = await db
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError) return { ok: false, reason: "read_failed", cause: ticketError };
  if (!ticket) return { ok: false, reason: "not_found" };

  // O id do banco, em minúsculas: a chave precisa bater com `ticket_id::text`.
  const stored = await putTicketAttachment({
    supabase: db,
    ticketId: ticket.id,
    body: await file.read(),
    mime: file.type,
  });
  if (!stored) return { ok: false, reason: "storage_failed" };

  const uploader =
    actor.kind === "user" ? { uploaded_by_user_id: actor.userId } : { uploaded_by_token_id: actor.tokenId };
  const { data: row, error: insertError } = await db
    .from("ticket_attachments")
    .insert({
      ticket_id: ticket.id,
      bucket: TICKET_ATTACHMENTS_BUCKET,
      object_key: stored.objectKey,
      file_name: sanitizeAttachmentFileName(file.name),
      mime: stored.mime,
      size_bytes: stored.sizeBytes,
      sha256: stored.sha256,
      ...uploader,
    })
    .select(TIMELINE_ATTACHMENT_SELECT)
    .single();

  if (insertError || !row) {
    // Sem linha, o objeto não é de ninguém: apaga antes de responder.
    await removeTicketAttachment(db, stored.objectKey);
    return { ok: false, reason: "insert_failed", error: mapTicketError(insertError), cause: insertError };
  }

  return {
    ok: true,
    data: {
      id: row.id,
      file_name: row.file_name,
      mime: row.mime,
      size_bytes: row.size_bytes,
      uploaded_by_user_id: row.uploaded_by_user_id,
      uploaded_by_token_id: row.uploaded_by_token_id,
      created_at: row.created_at,
    },
  };
}
