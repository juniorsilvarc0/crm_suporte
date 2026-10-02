import { setActiveTicket } from "@/features/tickets/server/ticket-service";
import { activeTicketBodySchema } from "@/lib/api/v1/conversations";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, invalidInput, notFound } from "@/lib/api/v1/responses";
import { ticketApiError } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O ticket em foco da conversa: é ele que recebe as mensagens novas.
 * `ticket_id: null` tira o foco. O mesmo foco de novo é no-op (`changed:
 * false`). Ticket de outra conversa (ou que não existe): 422 em `ticket_id`;
 * ticket encerrado: 409 `ticket_terminal`. É escrita de ticket: `tickets:write`.
 * Devolve o foco que ficou, não a conversa (a leitura dela é de
 * `conversations:read`).
 */
export const PUT = withApi<{ id: string }>(
  { route: "/api/v1/conversations/[id]/active-ticket", scopes: ["tickets:write"] },
  async ({ request, params, requestId, supabase, token }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Conversa não encontrada.");

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = activeTicketBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const result = await setActiveTicket(
      supabase,
      { kind: "token", tokenId: token.id },
      params.id,
      parsed.data.ticket_id
    );
    if (!result.ok) return ticketApiError(requestId, result.error);

    const { active_ticket_id, changed } = result.data;
    return apiOk({ conversation_id: params.id, active_ticket_id, changed });
  }
);
