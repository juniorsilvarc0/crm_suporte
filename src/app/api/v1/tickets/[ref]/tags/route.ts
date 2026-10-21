import { resolveTicketId } from "@/features/tickets/queries/get-api-ticket";
import { addTicketTags } from "@/features/tickets/server/ticket-service";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, invalidInput, notFound, unavailable } from "@/lib/api/v1/responses";
import { parseTicketRef, ticketApiError, ticketTagsBodySchema } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Acrescenta etiquetas ao ticket, com o token como autor. Só acrescenta (nada
 * aqui tira etiqueta) e vale também em ticket encerrado. Repetir é seguro: o
 * que o ticket já tem não entra de novo nem vai para a trilha. Por isso não
 * exige Idempotency-Key, e não muda a versão do ticket (sem If-Match).
 */
export const POST = withApi<{ ref: string }>(
  { route: "/api/v1/tickets/[ref]/tags", scopes: ["tickets:write"] },
  async ({ request, params, requestId, supabase, token }) => {
    const ref = parseTicketRef(params.ref);
    if (!ref) return notFound(requestId, "Ticket não encontrado.");

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = ticketTagsBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    let ticketId: string | null;
    try {
      ticketId = await resolveTicketId(supabase, ref);
    } catch (error) {
      console.error(`[api/v1] ${requestId} ticket ref`, error);
      return unavailable(requestId, "o ticket");
    }
    if (!ticketId) return notFound(requestId, "Ticket não encontrado.");

    const result = await addTicketTags(supabase, { kind: "token", tokenId: token.id }, ticketId, parsed.data.tags);
    if (!result.ok) return ticketApiError(requestId, result.error);
    return apiOk(result.data);
  }
);
