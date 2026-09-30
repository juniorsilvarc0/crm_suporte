import { selectTicketList, toTicketListItems } from "@/features/tickets/queries/get-tickets-page";
import { createTicket } from "@/features/tickets/server/ticket-service";
import { afterCursorFilter, cursorPage, searchParamsOf } from "@/lib/api/v1/cursor";
import { apiError } from "@/lib/api/v1/errors";
import { IDEMPOTENCY_HEADER } from "@/lib/api/v1/idempotency";
import { apiPage, invalidInput, unavailable } from "@/lib/api/v1/responses";
import { missingScopes } from "@/lib/api/v1/scopes";
import { respondWithTicket } from "@/lib/api/v1/ticket-write";
import { ticketApiError, ticketCreateBodySchema, ticketListQuerySchema, toApiTicket } from "@/lib/api/v1/tickets";
import { withApi } from "@/lib/api/v1/with-api";
import { searchTokens } from "@/lib/formatters/search-text";
import { readJsonBody } from "@/lib/http/read-json-body";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

const Q_SCOPES = ["contacts:read", "customers:read"] as const;
export const dynamic = "force-dynamic";

/** Tickets em ordem de `updated_at` crescente, com cursor e filtros. */
export const GET = withApi({ route: "/api/v1/tickets", scopes: ["tickets:read"] }, async ({ request, requestId, supabase, token }) => {
  const parsed = ticketListQuerySchema.safeParse(searchParamsOf(request));
  if (!parsed.success) return invalidInput(requestId, parsed.error);
  const params = parsed.data;

  // `q` procura também no nome do contato e na razão social e CNPJ da empresa
  // (search_text da view): sem os escopos deles, a busca revelaria o que o DTO
  // de ticket não entrega (só os ids).
  const missing = params.q ? missingScopes(token.scopes, Q_SCOPES) : [];
  if (missing.length > 0) {
    return apiError(
      requestId,
      403,
      "insufficient_scope",
      "A busca q também procura no contato e na empresa: exige contacts:read e customers:read.",
      { required: missing }
    );
  }

  let query = selectTicketList(supabase);
  if (params.status) query = query.in("status", params.status);
  if (params.priority) query = query.in("priority", params.priority);
  if (params.is_terminal !== undefined) query = query.eq("is_terminal", params.is_terminal);
  if (params.sla_breached !== undefined) query = query.eq("sla_breached", params.sla_breached);
  if (params.product_id) query = query.eq("product_id", params.product_id);
  if (params.assignee_id === "none") query = query.is("assigned_to_user_id", null);
  else if (params.assignee_id) query = query.eq("assigned_to_user_id", params.assignee_id);
  if (params.customer_id) query = query.eq("customer_id", params.customer_id);
  if (params.contact_id) query = query.eq("contact_id", params.contact_id);
  if (params.conversation_id) query = query.eq("conversation_id", params.conversation_id);
  // Tokens só com [a-z0-9]: entram no ilike sem escape (search-text.ts).
  for (const token of searchTokens(params.q)) {
    query = query.ilike("search_text", `%${token}%`);
  }
  if (params.updated_since) query = query.gte("updated_at", params.updated_since);
  if (params.cursor) query = query.or(afterCursorFilter(params.cursor));

  const { data, error } = await query
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(params.limit + 1);
  if (error) {
    console.error(`[api/v1] ${requestId} tickets`, error.message);
    return unavailable(requestId, "os tickets");
  }
  const items = toTicketListItems(data ?? [], `[api/v1] ${requestId} tickets`);
  if (!items) return unavailable(requestId, "os tickets");

  const page = cursorPage(items, params.limit);
  const now = new Date();
  return apiPage(
    page.items.map((ticket) => toApiTicket(ticket, now)),
    page.nextCursor
  );
});

/**
 * Abre um ticket na conversa, como o token (origem `ai` ou `api`, pelo tipo
 * dele). Idempotente em duas camadas: a Idempotency-Key da v1 (24 h, com o
 * corpo) e a mesma chave na RPC (por token, sem prazo). 201 criado; 200 já
 * existia (o ticket como está). O token nunca "assume" o atendimento.
 */
export const POST = withApi(
  { route: "/api/v1/tickets", scopes: ["tickets:write"], idempotency: "required" },
  async ({ request, requestId, supabase, token }) => {
    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = ticketCreateBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);
    const input = parsed.data;

    const result = await createTicket(
      supabase,
      { kind: "token", tokenId: token.id },
      {
        conversation_id: input.conversation_id,
        title: input.title,
        priority: input.priority,
        description: input.description,
        product_id: input.product_id,
        category_id: input.category_id,
        take_over: false,
        // withApi já exigiu e validou a chave (mesmo formato de tickets.idempotency_key).
        idempotency_key: request.headers.get(IDEMPOTENCY_HEADER) ?? "",
        status: input.status,
        external_id: input.external_id,
        // Veio do JSON.parse: os valores são JSON.
        ai_triage: input.ai_triage as { [key: string]: Json } | undefined,
        assigned_to_user_id: input.assignee_id,
      }
    );
    if (!result.ok) return ticketApiError(requestId, result.error, { externalId: input.external_id !== undefined });

    return respondWithTicket(supabase, requestId, result.data.ticket.id, (ticket) => ticket, result.data.created ? 201 : 200);
  }
);
