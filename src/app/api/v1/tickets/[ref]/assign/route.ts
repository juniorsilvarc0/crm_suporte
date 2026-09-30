import { assignTicket } from "@/features/tickets/server/ticket-service";
import { apiError } from "@/lib/api/v1/errors";
import { invalidInput } from "@/lib/api/v1/responses";
import { respondWithTicket, ticketWriteTarget } from "@/lib/api/v1/ticket-write";
import { ticketApiError, ticketAssignBodySchema } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Troca o responsável (GET /users lista quem pode receber) ou tira (null).
 * Responsável inativo: 422 `assignee_inactive`. O mesmo de novo é no-op.
 */
export const POST = withApi<{ ref: string }>(
  { route: "/api/v1/tickets/[ref]/assign", scopes: ["tickets:write"] },
  async ({ request, params, requestId, supabase, token }) => {
    const target = await ticketWriteTarget(supabase, request, requestId, params.ref);
    if (!target.ok) return target.response;

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = ticketAssignBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const result = await assignTicket(
      supabase,
      { kind: "token", tokenId: token.id },
      target.ticketId,
      target.version,
      parsed.data.assignee_id
    );
    if (!result.ok) return ticketApiError(requestId, result.error);

    return respondWithTicket(supabase, requestId, target.ticketId, (ticket) => ({ ticket, changed: result.data.changed }));
  }
);
