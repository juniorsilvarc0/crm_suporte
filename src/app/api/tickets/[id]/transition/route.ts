import { NextResponse } from "next/server";

import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { ticketTransitionSchema } from "@/features/tickets/schemas/ticket";
import { transitionTicket } from "@/features/tickets/server/ticket-service";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

/**
 * Move o ticket na matriz de ticket_status_transitions (a lista, o quadro e as
 * ações rápidas). Cancelar exige motivo: o zod responde 400 no campo `reason`,
 * e a RPC confere de novo (REASON_REQUIRED → 422). Destino fora da matriz →
 * 409 `invalid_transition` com `allowed` e `current` (de um terminal, `allowed`
 * vem vazio); versão velha → 409 `version_conflict` com `current_version`. O
 * mesmo status de novo é no-op (`changed: false`).
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

  const parsed = ticketTransitionSchema.safeParse(body.data);
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

  const { to, version, reason } = parsed.data;
  const result = await transitionTicket(
    createSupabaseAdminClient(),
    { kind: "user", userId: auth.viewer.id },
    id,
    to,
    version,
    reason
  );
  if (!result.ok) return ticketErrorResponse("[POST /api/tickets/[id]/transition]", result.error);

  const { ticket, from, to: target, changed } = result.data;
  return NextResponse.json({ ok: true, ticket, from, to: target, changed });
}
