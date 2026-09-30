import { transitionTicket } from "@/features/tickets/server/ticket-service";
import { apiError } from "@/lib/api/v1/errors";
import { invalidInput } from "@/lib/api/v1/responses";
import { respondWithTicket, ticketWriteTarget } from "@/lib/api/v1/ticket-write";
import { ticketApiError, ticketTransitionBodySchema } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Move o ticket na matriz (GET /ticket-statuses mostra os destinos). Destino
 * fora dela: 409 `invalid_transition` com `allowed` e `current`. Cancelar
 * exige `reason`. O mesmo status de novo é no-op (`changed: false`).
 */
export const POST = withApi<{ ref: string }>(
  { route: "/api/v1/tickets/[ref]/transitions", scopes: ["tickets:write"] },
  async ({ request, params, requestId, supabase, token }) => {
    const target = await ticketWriteTarget(supabase, request, requestId, params.ref);
    if (!target.ok) return target.response;

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = ticketTransitionBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const result = await transitionTicket(
      supabase,
      { kind: "token", tokenId: token.id },
      target.ticketId,
      parsed.data.to,
      target.version,
      parsed.data.reason
    );
    if (!result.ok) return ticketApiError(requestId, result.error);

    const { from, to, changed } = result.data;
    return respondWithTicket(supabase, requestId, target.ticketId, (ticket) => ({ ticket, changed, from, to }));
  }
);
