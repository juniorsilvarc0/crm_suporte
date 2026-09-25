import { NextResponse } from "next/server";
import { z } from "zod";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Catálogo mantido pelo usuário, no mesmo formato de /api/procedures.
const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do tipo de atendimento.")
    .max(120, "No máximo 120 caracteres."),
});

export async function POST(request: Request) {
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

  const parsed = createSchema.safeParse(body.data);
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
  const { data, error } = await supabase
    .from("appointment_types")
    .insert({ name: parsed.data.name })
    .select("id, name")
    .single();

  // 23505 = alguém criou o mesmo nome em outra aba. Devolve o existente para o
  // combobox selecionar, em vez de acusar erro de quem digitou.
  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("appointment_types")
      .select("id, name")
      .ilike("name", parsed.data.name)
      .is("archived_at", null)
      .maybeSingle();
    return NextResponse.json(
      { ok: false, message: "Esse tipo já existe.", appointmentType: existing ?? null },
      { status: 409 }
    );
  }
  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível criar o tipo de atendimento." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, appointmentType: data });
}
