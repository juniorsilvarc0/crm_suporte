import { conversationExists, getApiConversationMessages } from "@/features/chat/queries/get-api-conversation";
import { messageListQuerySchema, searchParamsOf } from "@/lib/api/v1/cursor";
import { apiPage, invalidInput, notFound, unavailable } from "@/lib/api/v1/responses";
import { hasScope } from "@/lib/api/v1/scopes";
import { withApi } from "@/lib/api/v1/with-api";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * As mensagens da conversa, da MAIS NOVA para a mais antiga. A nota interna
 * (`type: note`) é do time e só entra com `comments:read`, como na timeline do
 * ticket: o preset da IA não tem esse escopo. Sem mídia por URL: só o tipo.
 */
export const GET = withApi<{ id: string }>(
  { route: "/api/v1/conversations/[id]/messages", scopes: ["conversations:read"] },
  async ({ request, params, requestId, supabase, token }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Conversa não encontrada.");

    const parsed = messageListQuerySchema.safeParse(searchParamsOf(request));
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    try {
      // Página vazia não diz se a conversa existe: a leitura dela separa o 404.
      const [exists, page] = await Promise.all([
        conversationExists(supabase, params.id),
        getApiConversationMessages(supabase, params.id, {
          before: parsed.data.cursor,
          limit: parsed.data.limit,
          notes: hasScope(token.scopes, "comments:read"),
        }),
      ]);
      if (!exists) return notFound(requestId, "Conversa não encontrada.");
      return apiPage(page.items, page.nextCursor);
    } catch (error) {
      console.error(`[api/v1] ${requestId} messages`, error);
      return unavailable(requestId, "as mensagens");
    }
  }
);
