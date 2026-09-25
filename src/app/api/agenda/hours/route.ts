import { NextResponse } from "next/server";
import { z } from "zod";

import { isValidTime, normalizeTimes } from "@/features/appointments/lib/agenda-config";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * A grade é gravada INTEIRA, os sete dias de uma vez.
 *
 * É uma lista curta que a tela edita como um bloco só. Gravar dia a dia abriria
 * a porta para salvar metade da configuração e deixar o resto para trás se algo
 * falhasse no meio.
 */
const hoursSchema = z.object({
  hours: z
    .array(z.array(z.string().refine(isValidTime, "Horário inválido.")))
    .length(7, "A grade precisa ter os sete dias."),
});

export async function PUT(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

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

  const parsed = hoursSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os horários informados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const rows = parsed.data.hours.map((times, weekday) => ({
    weekday,
    times: normalizeTimes(times),
  }));

  const { error } = await supabase.from("agenda_hours").upsert(rows, { onConflict: "weekday" });

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível salvar a grade de horários." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    hours: rows.map((row) => row.times),
    message: "Grade de horários salva.",
  });
}
