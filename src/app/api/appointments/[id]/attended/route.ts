import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { syncDealsOnAttendance } from "@/features/deals/queries/sync-attendance";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from("appointments")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ ok: false, message: existingError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json(
      { ok: false, message: "Agendamento não encontrado." },
      { status: 404 }
    );
  }

  if (existing.status === "cancelado" || existing.status === "faltou") {
    return NextResponse.json(
      { ok: false, message: "Agendamento cancelado não pode ser marcado como compareceu." },
      { status: 409 }
    );
  }

  const { data: appointment, error: updateError } = await supabase
    .from("appointments")
    .update({ status: "compareceu" })
    .eq("id", id)
    .select("lead_id")
    .single();

  if (updateError) {
    return NextResponse.json({ ok: false, message: updateError.message }, { status: 500 });
  }

  let message = "Comparecimento registrado.";
  if (appointment?.lead_id) {
    // O update do card projeta a etapa da pessoa no mesmo comando pelo trigger
    // do banco. Não escrevemos uma segunda versão independente da etapa aqui.
    const sync = await syncDealsOnAttendance(supabase, {
      leadId: appointment.lead_id,
      appointmentId: id,
    });
    if (sync.ambiguous) {
      message =
        "Comparecimento registrado. Há mais de uma oportunidade ativa; mova o card correto no Funil.";
    }
  }

  revalidatePath("/app");
  revalidatePath("/app/agendamentos");
  revalidatePath("/app/leads");
  revalidatePath("/app/funil");

  return NextResponse.json({ ok: true, message });
}
