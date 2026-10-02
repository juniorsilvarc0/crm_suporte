import { NextResponse } from "next/server";

import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { ticketCommentSchema } from "@/features/tickets/schemas/comment";
import { addTicketComment } from "@/features/tickets/server/ticket-comment";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[POST /api/tickets/[id]/comments]";

/**
 * Comentário interno do ticket (o composer do detalhe), pelo addTicketComment
 * (a mesma escrita da API v1), com o autor da sessão, nunca do corpo. Qualquer
 * usuário ativo comenta. Devolve as colunas de TicketComment, as da timeline.
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

  const result = await addTicketComment(
    createSupabaseAdminClient(),
    { kind: "user", userId: auth.viewer.id },
    id,
    parsed.data.body
  );
  if (!result.ok) return ticketErrorResponse(ROUTE, result.error, result.cause);

  return NextResponse.json({ ok: true, comment: result.data }, { status: 201 });
}
