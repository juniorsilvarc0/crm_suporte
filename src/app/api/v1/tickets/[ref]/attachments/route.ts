import { resolveTicketId } from "@/features/tickets/queries/get-api-ticket";
import { addTicketAttachment } from "@/features/tickets/server/ticket-attachment";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { toApiAttachment } from "@/lib/api/v1/ticket-activity";
import { parseTicketRef, ticketApiError } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@/lib/storage/ticket-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Folga do envelope multipart sobre o teto do arquivo (a mesma da rota da tela).
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const TOO_LARGE_MESSAGE = "Arquivo muito grande (máx. 50 MB).";

const fileError = (requestId: string, status: 400 | 413, message: string) =>
  apiError(requestId, status, status === 413 ? "payload_too_large" : "validation_error", message, {
    fields: { file: message },
  });

/**
 * Anexa um arquivo ao ticket: multipart/form-data, SÓ o campo `file`, até 50
 * MB. O token é o autor. Exige Idempotency-Key: o hash é das partes (nome,
 * tipo, tamanho e sha256 do arquivo), então reenviar o mesmo arquivo repete a
 * resposta sem gravar de novo.
 *
 * O withApi recusa o corpo acima do teto pelo Content-Length ANTES de ler, lê
 * o multipart uma vez só e o entrega em `form`.
 */
export const POST = withApi<{ ref: string }>(
  {
    route: "/api/v1/tickets/[ref]/attachments",
    scopes: ["attachments:write"],
    idempotency: "required",
    body: "multipart",
    maxBodyBytes: TICKET_ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES,
  },
  async ({ params, requestId, supabase, token, form }) => {
    const ref = parseTicketRef(params.ref);
    if (!ref) return notFound(requestId, "Ticket não encontrado.");
    if (!form) throw new Error("withApi não entregou o multipart");

    const extra = [...new Set(form.keys())].filter((name) => name !== "file");
    if (extra.length > 0) {
      return apiError(requestId, 400, "validation_error", "Revise os campos.", {
        fields: Object.fromEntries(extra.map((name) => [name, "Campo não aceito."])),
      });
    }
    const files = form.getAll("file");
    const file = files[0];
    if (files.length !== 1 || !(file instanceof File)) {
      return fileError(requestId, 400, "Envie um arquivo, e só um, no campo file.");
    }
    if (file.size === 0) return fileError(requestId, 400, "O arquivo está vazio.");
    if (file.size > TICKET_ATTACHMENT_MAX_BYTES) return fileError(requestId, 413, TOO_LARGE_MESSAGE);

    let ticketId: string | null;
    try {
      ticketId = await resolveTicketId(supabase, ref);
    } catch (error) {
      console.error(`[api/v1] ${requestId} ticket ref`, error);
      return unavailable(requestId, "o ticket");
    }
    if (!ticketId) return notFound(requestId, "Ticket não encontrado.");

    const result = await addTicketAttachment(supabase, { kind: "token", tokenId: token.id }, ticketId, {
      name: file.name,
      type: file.type,
      read: async () => Buffer.from(await file.arrayBuffer()),
    });
    if (!result.ok) {
      switch (result.reason) {
        case "read_failed":
          console.error(`[api/v1] ${requestId} attachment`, result.cause.code, result.cause.message);
          return unavailable(requestId, "o ticket");
        case "not_found":
          return notFound(requestId, "Ticket não encontrado.");
        case "storage_failed":
          return apiError(
            requestId,
            502,
            "storage_unavailable",
            "Não foi possível guardar o arquivo agora. Tente de novo.",
            {},
            { "Retry-After": "5" }
          );
        case "insert_failed":
          if (result.error.status >= 500) {
            console.error(`[api/v1] ${requestId} attachment`, result.cause?.code, result.cause?.message);
          }
          return ticketApiError(requestId, result.error);
      }
    }
    return apiOk(toApiAttachment(result.data), { status: 201 });
  }
);
