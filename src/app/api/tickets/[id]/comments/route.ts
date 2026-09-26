import { NextResponse } from "next/server";

import { mapTicketError } from "@/features/tickets/lib/map-ticket-error";
import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { TIMELINE_COMMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import { ticketCommentSchema } from "@/features/tickets/schemas/comment";
import type { TicketComment } from "@/features/tickets/types";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[POST /api/tickets/[id]/comments]";

/**
 * Comentário interno do ticket (o composer do detalhe). Sem RPC e sem evento
 * (decisão 14 da Fase 4): INSERT direto por grant de coluna, com o autor da
 * sessão, nunca do corpo. Qualquer usuário ativo comenta; o banco aceita
 * comentário também em ticket encerrado (trg_ticket_comments_guard não olha o
 * status). Devolve as colunas de TicketComment, as mesmas da timeline.
 *
 * O ticket é lido antes: sem ele, a FK responderia 23503, que o mapa de erro
 * trata como bug (500), e o 404 ficaria indistinguível de falha do banco.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Ticket inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = ticketCommentSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (ticketError) return ticketErrorResponse(ROUTE, mapTicketError(ticketError), ticketError);
  if (!ticket) {
    return ticketErrorResponse(ROUTE, {
      status: 404,
      code: "not_found",
      message: "Ticket não encontrado.",
    });
  }

  const { data, error } = await supabase
    .from("ticket_comments")
    .insert({ ticket_id: id, author_user_id: auth.viewer.id, body: parsed.data.body })
    .select(TIMELINE_COMMENT_SELECT)
    .single();
  if (error) return ticketErrorResponse(ROUTE, mapTicketError(error), error);

  const comment: TicketComment = data;
  return NextResponse.json({ ok: true, comment }, { status: 201 });
}
