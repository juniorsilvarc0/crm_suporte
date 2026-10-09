import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getAppointments } from "@/features/appointments/queries/get-appointments";
import { appointmentCreateSchema } from "@/features/appointments/schemas/appointment";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function isoParam(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Os compromissos de [`?from=`, `?to=`) — os dois obrigatórios. Serve ao aviso
 * de conflito do diálogo de agendamento, que também abre fora da Agenda (na
 * ficha do ticket). Só o que o aviso usa: horário, duração, situação, técnico,
 * tipo e assunto.
 */
export async function GET(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const from = isoParam(url.searchParams.get("from"));
  const to = isoParam(url.searchParams.get("to"));
  if (!from || !to || to <= from) {
    return NextResponse.json({ ok: false, message: "Período inválido." }, { status: 400 });
  }

  // Leitura resiliente (erro vira [] + log): o aviso é melhor esforço e nunca
  // impede o agendamento.
  const appointments = await getAppointments({ startIso: from, endIso: to });
  return NextResponse.json({
    ok: true,
    appointments: appointments.map((item) => ({
      id: item.id,
      scheduled_at: item.scheduled_at,
      duration_min: item.duration_min,
      status: item.status,
      assignee_id: item.assignee_id,
      kind: item.kind,
      title: item.title,
    })),
  });
}

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
