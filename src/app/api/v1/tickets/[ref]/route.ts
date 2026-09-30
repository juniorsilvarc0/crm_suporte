import { getApiTicket } from "@/features/tickets/queries/get-api-ticket";
import { updateTicket } from "@/features/tickets/server/ticket-service";
import { apiError } from "@/lib/api/v1/errors";
import { invalidInput, notFound, unavailable } from "@/lib/api/v1/responses";
import { respondWithTicket, ticketWriteTarget } from "@/lib/api/v1/ticket-write";
import { parseTicketRef, ticketApiError, ticketPatchBodySchema, ticketResponse } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { ref: string };

/** Um ticket pelo id ou pelo protocolo, com o ETag da versão. */
export const GET = withApi<Params>({ route: "/api/v1/tickets/[ref]", scopes: ["tickets:read"] }, async ({ params, requestId, supabase }) => {
  const ref = parseTicketRef(params.ref);
  if (!ref) return notFound(requestId, "Ticket não encontrado.");

  try {
    const ticket = await getApiTicket(supabase, ref);
    if (!ticket) return notFound(requestId, "Ticket não encontrado.");
    return ticketResponse(ticket, ticket.version);
  } catch (error) {
    console.error(`[api/v1] ${requestId} ticket`, error);
    return unavailable(requestId, "o ticket");
  }
});

/**
 * Título, descrição, prioridade, fila, categoria e empresa. Ausente não mexe;
 * null tira. Exige If-Match. O mesmo valor de novo é no-op (`changed: false`)
 * ANTES de conferir a versão: repetir um PATCH que já valeu não dá 412.
 */
export const PATCH = withApi<Params>(
  { route: "/api/v1/tickets/[ref]", scopes: ["tickets:write"] },
  async ({ request, params, requestId, supabase, token }) => {
    const target = await ticketWriteTarget(supabase, request, requestId, params.ref);
    if (!target.ok) return target.response;

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = ticketPatchBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const result = await updateTicket(supabase, { kind: "token", tokenId: token.id }, target.ticketId, target.version, parsed.data);
    if (!result.ok) return ticketApiError(requestId, result.error);

    return respondWithTicket(supabase, requestId, target.ticketId, (ticket) => ({ ticket, changed: result.data.changed }));
  }
);
