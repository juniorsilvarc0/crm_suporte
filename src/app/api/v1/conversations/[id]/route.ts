import { getApiConversation } from "@/features/chat/queries/get-api-conversation";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A conversa: quem conduz (`status`), o ticket em foco e de quem ela é. Só lê:
 * não zera as não lidas. O telefone do canal não sai aqui (o contato tem o
 * dele em GET /contacts/{id}).
 */
export const GET = withApi<{ id: string }>(
  { route: "/api/v1/conversations/[id]", scopes: ["conversations:read"] },
  async ({ params, requestId, supabase }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Conversa não encontrada.");

    try {
      const conversation = await getApiConversation(supabase, params.id);
      if (!conversation) return notFound(requestId, "Conversa não encontrada.");
      return apiOk(conversation);
    } catch (error) {
      console.error(`[api/v1] ${requestId} conversation`, error);
      return unavailable(requestId, "a conversa");
    }
  }
);
