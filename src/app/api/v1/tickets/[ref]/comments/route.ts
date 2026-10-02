import { resolveTicketId } from "@/features/tickets/queries/get-api-ticket";
import { addTicketComment } from "@/features/tickets/server/ticket-comment";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, invalidInput, notFound, unavailable } from "@/lib/api/v1/responses";
import { commentBodySchema, toApiComment } from "@/lib/api/v1/ticket-activity";
import { parseTicketRef, ticketApiError } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Comentário INTERNO no ticket, com o token como autor (nunca vai ao
 * cliente). Vale também em ticket encerrado. Exige Idempotency-Key: repetir
 * não duplica o comentário.
 */
export const POST = withApi<{ ref: string }>(
  { route: "/api/v1/tickets/[ref]/comments", scopes: ["comments:write"], idempotency: "required" },
  async ({ request, params, requestId, supabase, token }) => {
    const ref = parseTicketRef(params.ref);
    if (!ref) return notFound(requestId, "Ticket não encontrado.");

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = commentBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    let ticketId: string | null;
    try {
      ticketId = await resolveTicketId(supabase, ref);
    } catch (error) {
      console.error(`[api/v1] ${requestId} ticket ref`, error);
      return unavailable(requestId, "o ticket");
    }
    if (!ticketId) return notFound(requestId, "Ticket não encontrado.");

    const result = await addTicketComment(supabase, { kind: "token", tokenId: token.id }, ticketId, parsed.data.body);
    if (!result.ok) {
      if (result.error.status >= 500) {
        console.error(`[api/v1] ${requestId} comment`, result.cause?.code, result.cause?.message);
        // Não deu para LER o ticket: indisponível (como no anexo), não erro interno.
        if (result.stage === "ticket") return unavailable(requestId, "o ticket");
      }
      return ticketApiError(requestId, result.error);
    }
    return apiOk(toApiComment(result.data), { status: 201 });
  }
);
