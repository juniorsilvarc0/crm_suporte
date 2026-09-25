import { NextResponse } from "next/server";
import { z } from "zod";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();

const updateSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da unidade.").max(120).optional(),
  address: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(240).nullable().optional()
  ),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, message: "Unidade inválida." }, { status: 400 });
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

  const parsed = updateSchema.safeParse(body.data);
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
    .update(parsed.data)
    .eq("id", parsedId.data)
    .select("id, name, address")
    .maybeSingle();

  if (error?.code === "23505") {
    return NextResponse.json(
      { ok: false, message: "Já existe uma unidade com esse nome." },
      { status: 409 }
    );
  }
  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível atualizar a unidade." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Unidade não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, unit: data, message: "Unidade atualizada." });
}

/**
 * Arquiva, não apaga.
 *
 * A FK de `appointments.unit_id` é `on delete set null`, mas apagar de verdade
 * ainda assim apagaria de qual unidade foi o atendimento passado. Arquivar tira
 * da lista e preserva o histórico.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, message: "Unidade inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("clinic_units")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível remover a unidade." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Unidade não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: "Unidade removida da lista." });
}
