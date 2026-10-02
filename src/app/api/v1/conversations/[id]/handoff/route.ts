import { handoffConversation } from "@/features/tickets/server/ticket-service";
import { handoffBodySchema } from "@/lib/api/v1/conversations";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, invalidInput, notFound } from "@/lib/api/v1/responses";
import { ticketApiError } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handoff: o token passa a conversa de `bot` para `human`. O motivo e o resumo
 * ficam numa nota interna no chat (nunca vão ao cliente), e o pedido entra na
 * trilha do ticket informado ou do que está em foco. Conversa já com um humano:
 * 200 com `changed: false`. Conversa resolvida: 409
 * `conversation_not_owned_by_ai` (quem a devolve à IA é uma mensagem nova do
 * cliente). A volta para `bot` é só pela tela.
 *
 * Devolve o resultado do pedido, não a conversa: `conversations:handoff` não
 * dá a leitura (para ela, GET /conversations/{id}).
 */
export const POST = withApi<{ id: string }>(
  { route: "/api/v1/conversations/[id]/handoff", scopes: ["conversations:handoff"], idempotency: "required" },
  async ({ request, params, requestId, supabase, token }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Conversa não encontrada.");

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = handoffBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const result = await handoffConversation(supabase, token.id, params.id, parsed.data);
    if (!result.ok) return ticketApiError(requestId, result.error);

    const { conversation, changed, ticket_id, note_id } = result.data;
    return apiOk({ conversation_id: conversation.id, status: conversation.status, changed, ticket_id, note_id });
  }
);
