import { NextResponse } from "next/server";

import { getAgendaConfig } from "@/features/appointments/queries/get-agenda-config";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";

export const runtime = "nodejs";

/**
 * Tipos + unidades + grade, numa chamada só.
 *
 * O modal de agendamento precisa dos três ao abrir. Três rotas seriam três
 * idas ao servidor para montar um formulário — o mesmo motivo pelo qual o
 * catálogo de procedimentos é buscado sob demanda (UI.md §5.14).
 */
export async function GET() {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const config = await getAgendaConfig();
  return NextResponse.json({ ok: true, ...config });
}
