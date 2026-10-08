import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { appointmentCreateSchema } from "@/features/appointments/schemas/appointment";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Cadastro de um compromisso de agenda (member ou admin). O `created_by_user_id`
 * é o usuário da sessão, não vem do corpo. Os vínculos (ticket/empresa/contato/
 * técnico) são opcionais; as FKs são conferidas pelo banco.
 */
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

  const parsed = appointmentCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos destacados.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("appointments")
    .insert({ ...parsed.data, created_by_user_id: auth.viewer.id })
    .select("id")
    .single();

  if (error) {
    // FK inválida (empresa/ticket inexistente) é dado ruim do cliente → 422.
    const status = error.code === "23503" ? 422 : 500;
    console.error("[POST /api/appointments]", error.code, error.message);
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

  revalidatePath("/app/agendamentos");
  return NextResponse.json({ ok: true, appointment: { id: data.id } });
}
