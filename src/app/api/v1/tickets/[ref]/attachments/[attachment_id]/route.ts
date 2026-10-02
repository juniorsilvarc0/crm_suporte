import { findTicketId } from "@/features/tickets/queries/get-api-ticket";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { parseTicketRef } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { signTicketAttachment, TICKET_ATTACHMENTS_BUCKET } from "@/lib/storage/ticket-attachments";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vida da URL assinada (a mesma da rota da tela). */
const SIGNED_TTL_SECONDS = 600;

/**
 * O link do arquivo de um anexo: uma URL assinada de 10 min do bucket
 * privado, com nome, tipo e tamanho. O anexo é buscado pelo par (ticket,
 * anexo): o de outro ticket é 404, como o inexistente.
 */
export const GET = withApi<{ ref: string; attachment_id: string }>(
  { route: "/api/v1/tickets/[ref]/attachments/[attachment_id]", scopes: ["attachments:read"] },
  async ({ params, requestId, supabase }) => {
    const ref = parseTicketRef(params.ref);
    if (!ref || !isUuid(params.attachment_id)) return notFound(requestId, "Anexo não encontrado.");

    let ticketId: string | null;
    try {
      ticketId = await findTicketId(supabase, ref);
    } catch (error) {
      console.error(`[api/v1] ${requestId} ticket ref`, error);
      return unavailable(requestId, "o anexo");
    }
    if (!ticketId) return notFound(requestId, "Ticket não encontrado.");

    const { data: attachment, error } = await supabase
      .from("ticket_attachments")
      .select("bucket, object_key, file_name, mime, size_bytes")
      .eq("id", params.attachment_id)
      .eq("ticket_id", ticketId)
      .maybeSingle();
    if (error) {
      console.error(`[api/v1] ${requestId} attachment`, error.message);
      return unavailable(requestId, "o anexo");
    }
    // Só assina o bucket dos anexos: um valor estranho não vira acesso a outro.
    if (!attachment || attachment.bucket !== TICKET_ATTACHMENTS_BUCKET) {
      return notFound(requestId, "Anexo não encontrado.");
    }

    // Antes de assinar: o vencimento informado nunca passa do real.
    const expiresAt = new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString();
    const url = await signTicketAttachment(supabase, attachment, SIGNED_TTL_SECONDS);
    if (!url) {
      return apiError(requestId, 502, "storage_unavailable", "Não foi possível gerar o link agora. Tente de novo.", {}, {
        "Retry-After": "5",
      });
    }
    return apiOk(
      {
        url,
        expires_at: expiresAt,
        file_name: attachment.file_name,
        mime: attachment.mime,
        size_bytes: attachment.size_bytes,
      },
      // A URL assinada é uma credencial curta: nada de cache no caminho.
      { headers: { "Cache-Control": "no-store" } }
    );
  }
);
