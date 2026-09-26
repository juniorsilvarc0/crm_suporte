import { NextResponse } from "next/server";

import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { ticketFocusSchema } from "@/features/tickets/schemas/ticket";
import { setActiveTicket } from "@/features/tickets/server/ticket-service";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[PUT /api/chat/conversations/[id]/active-ticket]";

// Ticket em foco na conversa: é ele que carimba as mensagens novas. `ticket_id`
// null tira o foco. Pela RPC ticket_set_active (a coluna active_ticket_id só
// muda por ela); o mesmo foco de novo é no-op (changed=false), e a tela só avisa
// quando mudou. Ticket de outra conversa (ou inexistente) → 422 em ticket_id;
// ticket encerrado → 409.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Conversa inválida." }, { status: 400 });
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

  const parsed = ticketFocusSchema.safeParse(body.data);
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

  const result = await setActiveTicket(
    createSupabaseAdminClient(),
    { kind: "user", userId: auth.viewer.id },
    id,
    parsed.data.ticket_id
  );
  if (!result.ok) return ticketErrorResponse(ROUTE, result.error);

  const { active_ticket_id, changed } = result.data;
  return NextResponse.json({ ok: true, active_ticket_id, changed });
}
