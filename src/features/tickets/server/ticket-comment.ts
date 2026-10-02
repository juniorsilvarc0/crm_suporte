import type { SupabaseClient } from "@supabase/supabase-js";

import { mapTicketError } from "@/features/tickets/lib/map-ticket-error";
import { TIMELINE_COMMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import type { TicketActor } from "@/features/tickets/server/ticket-service";
import type { TicketComment, TicketError } from "@/features/tickets/types";
import type { Database } from "@/lib/supabase/types";

// Comentário interno do ticket: a tela (sessão) e a API v1 (token) passam por
// aqui. Sem RPC e sem evento (decisão 14 da Fase 4): INSERT por grant de
// coluna, com o autor vindo de quem chama, nunca do corpo. O banco aceita
// comentário também em ticket encerrado.

type DatabaseError = { message: string; code?: string };

/**
 * `cause` = o erro cru do banco, para a ROTA logar com o nome dela (nunca vai
 * ao cliente). `stage` diz onde parou: a API v1 trata a LEITURA do ticket que
 * falhou como indisponível (503), não como erro interno.
 */
export type TicketCommentResult =
  | { ok: true; data: TicketComment }
  | { ok: false; stage: "ticket" | "insert"; error: TicketError; cause?: DatabaseError };

/**
 * O ticket é lido antes: sem ele, a FK responderia 23503, que o mapa de erro
 * trata como bug (500), e o 404 ficaria indistinguível de falha do banco.
 */
export async function addTicketComment(
  db: SupabaseClient<Database>,
  actor: TicketActor,
  ticketId: string,
  body: string
): Promise<TicketCommentResult> {
  const { data: ticket, error: ticketError } = await db
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError) return { ok: false, stage: "ticket", error: mapTicketError(ticketError), cause: ticketError };
  if (!ticket) {
    return {
      ok: false,
      stage: "ticket",
      error: { status: 404, code: "not_found", message: "Ticket não encontrado." },
    };
  }

  const author = actor.kind === "user" ? { author_user_id: actor.userId } : { author_token_id: actor.tokenId };
  const { data, error } = await db
    .from("ticket_comments")
    .insert({ ticket_id: ticketId, ...author, body })
    .select(TIMELINE_COMMENT_SELECT)
    .single();
  if (error) return { ok: false, stage: "insert", error: mapTicketError(error), cause: error };
  return { ok: true, data };
}
