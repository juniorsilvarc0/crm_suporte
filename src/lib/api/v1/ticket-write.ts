import type { SupabaseClient } from "@supabase/supabase-js";

import { getApiTicket, resolveTicketId } from "@/features/tickets/queries/get-api-ticket";
import { apiError } from "@/lib/api/v1/errors";
import { parseIfMatch } from "@/lib/api/v1/if-match";
import { notFound, unavailable } from "@/lib/api/v1/responses";
import { parseTicketRef, ticketResponse } from "@/lib/api/v1/tickets";
import type { Database } from "@/lib/supabase/types";

// O que as escritas num ticket EXISTENTE (PATCH, transitions, assign) têm em
// comum, na ordem: o `{ref}` da rota, o If-Match (D7), e depois da RPC a
// releitura do ticket inteiro, com o ETag da versão nova.

type Admin = SupabaseClient<Database>;

export type TicketTarget = { ok: true; ticketId: string; version: number } | { ok: false; response: Response };

/**
 * `{ref}` bem formado + If-Match com uma versão. Protocolo que não existe já é
 * 404 aqui; um uuid que não existe, a própria RPC responde 404 (TICKET_NOT_FOUND).
 */
export async function ticketWriteTarget(
  supabase: Admin,
  request: Request,
  requestId: string,
  rawRef: unknown
): Promise<TicketTarget> {
  const ref = parseTicketRef(rawRef);
  if (!ref) return { ok: false, response: notFound(requestId, "Ticket não encontrado.") };

  const ifMatch = parseIfMatch(request);
  if (!ifMatch.ok) {
    return {
      ok: false,
      response:
        ifMatch.reason === "missing"
          ? apiError(requestId, 428, "precondition_required", 'Envie If-Match com o ETag do ticket (W/"<version>").')
          : apiError(requestId, 400, "invalid_if_match", 'If-Match inválido: use o ETag do ticket, W/"<version>".'),
    };
  }

  let ticketId: string | null;
  try {
    ticketId = await resolveTicketId(supabase, ref);
  } catch (error) {
    console.error(`[api/v1] ${requestId} ticket ref`, error);
    return { ok: false, response: unavailable(requestId, "o ticket") };
  }
  if (!ticketId) return { ok: false, response: notFound(requestId, "Ticket não encontrado.") };
  return { ok: true, ticketId, version: ifMatch.version };
}

/**
 * Relê o ticket depois da escrita. Se a leitura falhar, a escrita JÁ valeu:
 * repetir o mesmo pedido é seguro (o mesmo valor é no-op antes da versão).
 */
export async function respondWithTicket(
  supabase: Admin,
  requestId: string,
  ticketId: string,
  build: (ticket: NonNullable<Awaited<ReturnType<typeof getApiTicket>>>) => unknown,
  status = 200
): Promise<Response> {
  try {
    const ticket = await getApiTicket(supabase, { id: ticketId });
    if (ticket) return ticketResponse(build(ticket), ticket.version, status);
    console.error(`[api/v1] ${requestId} ticket sumiu depois da escrita`, ticketId);
  } catch (error) {
    console.error(`[api/v1] ${requestId} releitura do ticket`, error);
  }
  return unavailable(requestId, "o ticket");
}
