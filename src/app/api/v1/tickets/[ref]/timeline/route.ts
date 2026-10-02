import { findTicketId } from "@/features/tickets/queries/get-api-ticket";
import { getTicketTimeline } from "@/features/tickets/queries/get-ticket-timeline";
import { searchParamsOf } from "@/lib/api/v1/cursor";
import { apiPage, invalidInput, notFound, unavailable } from "@/lib/api/v1/responses";
import { hasScope } from "@/lib/api/v1/scopes";
import { encodeTimelineCursor, timelineQuerySchema, toApiTimelineItem } from "@/lib/api/v1/ticket-activity";
import { parseTicketRef } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A timeline do ticket, do MAIS NOVO para o mais antigo. `tickets:read` dá a
 * trilha (status e eventos) e os anexos. O resto é de outro recurso, e só
 * entra com o escopo dele, como o `q` de GET /tickets:
 *   - mensagens da conversa: `conversations:read`;
 *   - comentários internos: `comments:read`;
 *   - notas internas no chat: os dois.
 * O preset da IA não tem `comments:read`: ela não lê o que é só do time.
 */
export const GET = withApi<{ ref: string }>(
  { route: "/api/v1/tickets/[ref]/timeline", scopes: ["tickets:read"] },
  async ({ request, params, requestId, supabase, token }) => {
    const ref = parseTicketRef(params.ref);
    if (!ref) return notFound(requestId, "Ticket não encontrado.");

    const parsed = timelineQuerySchema.safeParse(searchParamsOf(request));
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    try {
      // Timeline vazia não diz se o ticket existe: a leitura dele separa o 404.
      const ticketId = await findTicketId(supabase, ref);
      if (!ticketId) return notFound(requestId, "Ticket não encontrado.");

      const messages = hasScope(token.scopes, "conversations:read");
      const comments = hasScope(token.scopes, "comments:read");
      const page = await getTicketTimeline(ticketId, {
        before: parsed.data.cursor,
        sources: { comments, messages, notes: messages && comments },
      });
      return apiPage(
        page.items.map(toApiTimelineItem),
        page.hasMore && page.nextBefore ? encodeTimelineCursor(page.nextBefore) : null
      );
    } catch (error) {
      console.error(`[api/v1] ${requestId} timeline`, error);
      return unavailable(requestId, "a timeline");
    }
  }
);
