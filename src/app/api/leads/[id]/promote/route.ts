import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Promove um lead a paciente pelo botão da tela.
 *
 * A regra vive na RPC `promote_lead_to_patient` (mesma que o gatilho de
 * agendamento usa): ela trava por lead, devolve o `patient_id` que já existe em
 * vez de criar um segundo cadastro e carimba `leads.converted_at`. Por isso a
 * rota é idempotente — clicar duas vezes devolve o mesmo paciente com ok:true.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Lead inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: patientId, error } = await supabase.rpc("promote_lead_to_patient", {
    p_lead_id: id,
    p_source: "manual",
    p_user_id: auth.viewer.id,
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  // A RPC devolve null quando o lead não existe.
  if (!patientId) {
    return NextResponse.json({ ok: false, message: "Lead não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/pacientes");
  revalidatePath("/app/leads");

  return NextResponse.json({
    ok: true,
    patientId,
    message: "Lead promovido a paciente.",
  });
}
