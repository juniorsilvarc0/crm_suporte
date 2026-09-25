import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { PATIENT_LIST_COLUMNS } from "@/features/patients/queries/get-patients";
import { createPatientSchema } from "@/features/patients/schemas/patient";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { data: body, error: bodyError } = await readJsonBody(request);
  if (bodyError) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = createPatientSchema.safeParse(body);
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

  // `lead_id` é vínculo, não coluna de `patients` — sai do payload do cadastro.
  const { lead_id: leadId, ...patientInput } = parsed.data;
  const supabase = createSupabaseAdminClient();

  // O lead é conferido ANTES de inserir: descobrir que ele já tem paciente só
  // depois criaria um cadastro clínico órfão a cada tentativa.
  if (leadId) {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, patient_id")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError) {
      return NextResponse.json({ ok: false, message: leadError.message }, { status: 500 });
    }
    if (!lead) {
      return NextResponse.json({ ok: false, message: "Lead não encontrado." }, { status: 404 });
    }
    if (lead.patient_id) {
      return NextResponse.json(
        { ok: false, message: "Este lead já está vinculado a um paciente." },
        { status: 409 }
      );
    }
  }

  const { data: patient, error } = await supabase
    .from("patients")
    .insert({
      ...patientInput,
      // 'manual' = veio de um lead pelo botão; 'cadastro' = nasceu paciente na
      // recepção. O histórico de como a pessoa entrou importa para auditoria.
      promotion_source: leadId ? "manual" : "cadastro",
      created_by_user_id: auth.viewer.id,
    })
    .select(PATIENT_LIST_COLUMNS)
    .single();

  if (error || !patient) {
    // O único índice único da tabela é o CPF (parcial, entre cadastros vivos).
    const duplicateCpf = error?.code === "23505";
    return NextResponse.json(
      {
        ok: false,
        message: duplicateCpf
          ? "Já existe paciente com este CPF."
          : (error?.message ?? "Não foi possível cadastrar o paciente."),
        ...(duplicateCpf ? { errors: { cpf: ["Já existe paciente com este CPF."] } } : {}),
      },
      { status: duplicateCpf ? 409 : 500 }
    );
  }

  if (leadId) {
    const { data: linked, error: linkError } = await supabase
      .from("leads")
      .update({ patient_id: patient.id, converted_at: new Date().toISOString() })
      // `is("patient_id", null)` fecha a corrida com o gatilho de agendamento,
      // que promove o mesmo lead sozinho: sem isso o vínculo criado por ele
      // seria sobrescrito e a pessoa ficaria com dois cadastros clínicos.
      .is("patient_id", null)
      .eq("id", leadId)
      .select("id")
      .maybeSingle();

    if (linkError || !linked) {
      // Cadastro clínico sem vínculo não serve para nada e ainda segura o CPF
      // no índice único, impedindo a nova tentativa. Arquiva (nunca apaga).
      await supabase
        .from("patients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", patient.id);

      return NextResponse.json(
        {
          ok: false,
          message: linkError
            ? "Paciente não pôde ser vinculado ao lead."
            : "Este lead já está vinculado a um paciente.",
        },
        { status: linkError ? 500 : 409 }
      );
    }

    revalidatePath("/app/leads");
  }

  revalidatePath("/app/pacientes");

  return NextResponse.json({ ok: true, patient, message: "Paciente cadastrado." });
}
