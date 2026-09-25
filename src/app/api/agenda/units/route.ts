import { NextResponse } from "next/server";
import { z } from "zod";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(240, "No máximo 240 caracteres.").optional()
);

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da unidade.")
    .max(120, "No máximo 120 caracteres."),
  address: optionalText,
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
    .from("clinic_units")
    .insert({ name: parsed.data.name, address: parsed.data.address ?? null })
    .select("id, name, address")
    .single();

  if (error?.code === "23505") {
    return NextResponse.json(
      { ok: false, message: "Já existe uma unidade com esse nome." },
      { status: 409 }
    );
  }
  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível criar a unidade." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, unit: data, message: "Unidade criada." });
}
