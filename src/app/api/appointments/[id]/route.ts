import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { appointmentUpdateSchema } from "@/features/appointments/schemas/appointment";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();

type Params = { params: Promise<{ id: string }> };

/** Edição parcial: só as chaves enviadas são gravadas. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const idResult = idSchema.safeParse((await params).id);
  if (!idResult.success) {
    return NextResponse.json({ ok: false, message: "Agendamento inválido." }, { status: 400 });
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = appointmentUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos destacados.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("appointments")
    .update(parsed.data)
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) {
    const status = error.code === "23503" ? 422 : 500;
    console.error("[PATCH /api/appointments/[id]]", error.code, error.message);
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 422
            ? "Um dos vínculos (empresa, ticket, contato ou técnico) não existe."
            : "Não foi possível salvar o agendamento.",
      },
      { status }
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Agendamento não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/agendamentos");
  return NextResponse.json({ ok: true, appointment: { id: data.id } });
}

/** Exclui o compromisso. */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const idResult = idSchema.safeParse((await params).id);
  if (!idResult.success) {
    return NextResponse.json({ ok: false, message: "Agendamento inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[DELETE /api/appointments/[id]]", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível excluir o agendamento." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Agendamento não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/agendamentos");
  return NextResponse.json({ ok: true });
}
