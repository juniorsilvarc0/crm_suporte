import { NextResponse } from "next/server";

import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { ticketAssignSchema } from "@/features/tickets/schemas/ticket";
import { assignTicket } from "@/features/tickets/server/ticket-service";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

/**
 * Troca ou tira o responsável do ticket (menu "Atribuir"). `assignee_id: null`
 * tem de vir explícito: a chave esquecida é 400, nunca "sem responsável" em
 * silêncio. Responsável inativo ou inexistente → 422 no campo `assignee_id`;
 * ticket encerrado → 409 `ticket_terminal`; versão velha → 409
 * `version_conflict`. O mesmo responsável de novo é no-op (`changed: false`).
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

  const parsed = ticketAssignSchema.safeParse(body.data);
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

  const { assignee_id, version } = parsed.data;
  const result = await assignTicket(
    createSupabaseAdminClient(),
    { kind: "user", userId: auth.viewer.id },
    id,
    version,
    assignee_id
  );
  if (!result.ok) return ticketErrorResponse("[POST /api/tickets/[id]/assign]", result.error);

  const { ticket, changed } = result.data;
  return NextResponse.json({ ok: true, ticket, changed });
}
