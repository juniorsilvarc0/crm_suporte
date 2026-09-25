import { NextResponse } from "next/server";
import { z } from "zod";

import { findAppointmentConflicts } from "@/features/appointments/lib/appointment-conflicts";
import { localDateTimeToIso } from "@/lib/formatters/date";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const querySchema = z.object({
  /** "YYYY-MM-DDTHH:MM" no fuso do app, igual ao campo do formulário. */
  at: z.string().min(1),
  duration: z.coerce.number().int().positive().max(24 * 60).default(60),
  ignore: z.uuid().optional(),
});

/**
 * Quem já ocupa o horário pedido.
 *
 * A consulta busca a JANELA DO DIA e o cruzamento fino acontece no TS, com a
 * mesma função que os testes exercitam. Fazer o cálculo de sobreposição em SQL
 * espalharia a regra por duas linguagens — e é a regra que decide se o alerta
 * aparece.
 */
export async function GET(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    at: url.searchParams.get("at") ?? "",
    duration: url.searchParams.get("duration") ?? undefined,
    ignore: url.searchParams.get("ignore") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, conflicts: [] }, { status: 400 });
  }

  const startIso = localDateTimeToIso(parsed.data.at);
  if (!startIso) {
    return NextResponse.json({ ok: false, conflicts: [] }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, conflicts: [] });
  }

  // Janela generosa em volta do horário: 12h para trás cobre um agendamento
  // longo que começou antes e ainda está correndo.
  const start = new Date(startIso);
  const from = new Date(start.getTime() - 12 * 60 * 60_000).toISOString();
  const to = new Date(start.getTime() + (parsed.data.duration + 60) * 60_000).toISOString();

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("id, scheduled_at, duration_min, status, leads(name)")
    .gte("scheduled_at", from)
    .lte("scheduled_at", to);

  if (error) {
    // Alerta é auxílio, não porteiro: falhar aqui não pode impedir o
    // agendamento. Loga e devolve "sem conflito conhecido".
    console.error("GET /api/appointments/conflicts", error.message);
    return NextResponse.json({ ok: true, conflicts: [] });
  }

  const conflicts = findAppointmentConflicts({
    candidates: (data ?? []).map((row) => ({
      id: row.id,
      scheduledAt: row.scheduled_at,
      durationMin: row.duration_min,
      leadName: (row.leads as { name: string | null } | null)?.name ?? null,
      status: row.status,
    })),
    startIso,
    durationMin: parsed.data.duration,
    ignoreId: parsed.data.ignore ?? null,
  });

  return NextResponse.json({ ok: true, conflicts });
}
