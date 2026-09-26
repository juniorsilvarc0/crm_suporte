import { NextResponse } from "next/server";

import { canDeleteComment, canEditComment } from "@/features/tickets/lib/comment-actions";
import { mapTicketError } from "@/features/tickets/lib/map-ticket-error";
import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { TIMELINE_COMMENT_SELECT } from "@/features/tickets/queries/get-ticket-timeline";
import { ticketCommentSchema } from "@/features/tickets/schemas/comment";
import type { TicketComment, TicketError } from "@/features/tickets/types";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

// Editar e apagar um comentário do ticket.
//
// O banco não confere o autor (grant por coluna, sem RPC, decisão 14 da Fase
// 4): a rota o confere com canEditComment/canDeleteComment, os mesmos
// predicados com que a tela decide o menu. O resto é do trigger
// trg_ticket_comments_guard: carimba edited_at (o service_role só tem UPDATE em
// body e deleted_at), apaga zerando o texto e recusa mexer em apagado
// (COMMENT_DELETED → 409, também na corrida entre duas abas).
//
// O comentário é sempre lido com `ticket_id = [id]`: um commentId de outro
// ticket é 404, nunca edita o que a tela não mostra.

type Params = { params: Promise<{ id: string; commentId: string }> };

type Db = ReturnType<typeof createSupabaseAdminClient>;

// O 409 da conferência prévia sai do mesmo mapa que o do trigger: a tela lê o
// mesmo corpo nos dois caminhos.
const COMMENT_DELETED = mapTicketError({ message: "COMMENT_DELETED" });

const NOT_AUTHOR: TicketError = {
  status: 403,
  code: "forbidden",
  message: "Só quem escreveu o comentário pode alterá-lo.",
};

const COMMENT_NOT_FOUND: TicketError = {
  status: 404,
  code: "not_found",
  message: "Comentário não encontrado.",
};

const ADMIN_ENV_MISSING = {
  ok: false,
  message: "Supabase admin não está configurado neste ambiente.",
};

/** 400 dos ids fora de UUID, ou null quando os dois servem. */
function invalidIds(id: string, commentId: string) {
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Ticket inválido." }, { status: 400 });
  }
  if (!isUuid(commentId)) {
    return NextResponse.json({ ok: false, message: "Comentário inválido." }, { status: 400 });
  }
  return null;
}

/** O comentário DESTE ticket, ou a resposta de erro pronta. */
async function loadComment(
  supabase: Db,
  route: string,
  ticketId: string,
  commentId: string
): Promise<TicketComment | NextResponse> {
  const { data, error } = await supabase
    .from("ticket_comments")
    .select(TIMELINE_COMMENT_SELECT)
    .eq("id", commentId)
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (error) return ticketErrorResponse(route, mapTicketError(error), error);
  if (!data) return ticketErrorResponse(route, COMMENT_NOT_FOUND);
  return data;
}

/** PATCH — troca o texto. O mesmo texto de novo não carimba edited_at (trigger). */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const route = "[PATCH /api/tickets/[id]/comments/[commentId]]";
  const { id, commentId } = await params;
  const invalid = invalidIds(id, commentId);
  if (invalid) return invalid;

  if (!hasSupabaseAdminEnv()) return NextResponse.json(ADMIN_ENV_MISSING, { status: 500 });

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
  const loaded = await loadComment(supabase, route, id, commentId);
  if (loaded instanceof NextResponse) return loaded;

  if (loaded.deleted_at) return ticketErrorResponse(route, COMMENT_DELETED);
  if (!canEditComment(loaded, auth.viewer.id)) return ticketErrorResponse(route, NOT_AUTHOR);

  const { data, error } = await supabase
    .from("ticket_comments")
    .update({ body: parsed.data.body })
    .eq("id", commentId)
    .eq("ticket_id", id)
    .select(TIMELINE_COMMENT_SELECT)
    .single();
  if (error) return ticketErrorResponse(route, mapTicketError(error), error);

  const comment: TicketComment = data;
  return NextResponse.json({ ok: true, comment });
}

/**
 * DELETE — soft delete: o comentário continua na timeline como "apagado". O
 * trigger carimba deleted_at com o relógio do banco (o valor enviado é
 * ignorado) e zera o texto; `body: null` vai junto para o pedido já cumprir
 * ticket_comments_body_check por si.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const route = "[DELETE /api/tickets/[id]/comments/[commentId]]";
  const { id, commentId } = await params;
  const invalid = invalidIds(id, commentId);
  if (invalid) return invalid;

  if (!hasSupabaseAdminEnv()) return NextResponse.json(ADMIN_ENV_MISSING, { status: 500 });

  const supabase = createSupabaseAdminClient();
  const loaded = await loadComment(supabase, route, id, commentId);
  if (loaded instanceof NextResponse) return loaded;

  if (loaded.deleted_at) return ticketErrorResponse(route, COMMENT_DELETED);
  if (!canDeleteComment(loaded, auth.viewer.id)) return ticketErrorResponse(route, NOT_AUTHOR);

  const { data, error } = await supabase
    .from("ticket_comments")
    .update({ body: null, deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("ticket_id", id)
    .select(TIMELINE_COMMENT_SELECT)
    .single();
  if (error) return ticketErrorResponse(route, mapTicketError(error), error);

  const comment: TicketComment = data;
  return NextResponse.json({ ok: true, comment });
}
