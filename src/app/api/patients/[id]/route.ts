import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { PATIENT_LIST_COLUMNS } from "@/features/patients/queries/get-patients";
import { updatePatientSchema } from "@/features/patients/schemas/patient";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ficha completa do paciente.
 *
 * ⚠️ Existe porque a lista traz só um recorte de colunas: abrir a edição a
 * partir dela sem buscar o resto **apagaria** os campos ausentes no primeiro
 * salvamento (o formulário envia tudo que renderiza). Rota de sessão, dado da
 * própria clínica — mas nunca chame isto de um componente público.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Paciente inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("GET /api/patients/[id]", error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível carregar o paciente." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Paciente não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, patient: data });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Paciente inválido." }, { status: 400 });
  }

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

  const parsed = updatePatientSchema.safeParse(body);
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

  // Campo ausente = "não altere"; campo vazio já virou `null` no schema. Sem
  // esta poda, um formulário parcial apagaria o que não estava na tela.
  // As chaves do schema são exatamente colunas de `patients` — o cast recupera
  // o tipo que `Object.fromEntries` achata em índice genérico.
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  ) as Database["public"]["Tables"]["patients"]["Update"];

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, message: "Nada para atualizar." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  // `updated_at` fica com o gatilho `trg_patients_set_updated_at`.
  const { data: patient, error } = await supabase
    .from("patients")
    .update(patch)
    .eq("id", id)
    .select(PATIENT_LIST_COLUMNS)
    .maybeSingle();

  if (error) {
    const duplicateCpf = error.code === "23505";
    return NextResponse.json(
      {
        ok: false,
        message: duplicateCpf ? "Já existe paciente com este CPF." : error.message,
        ...(duplicateCpf ? { errors: { cpf: ["Já existe paciente com este CPF."] } } : {}),
      },
      { status: duplicateCpf ? 409 : 500 }
    );
  }

  if (!patient) {
    return NextResponse.json({ ok: false, message: "Paciente não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/pacientes");
  return NextResponse.json({ ok: true, patient, message: "Paciente atualizado." });
}

// Arquiva, não apaga: agendamento, lead e histórico continuam ligados ao mesmo
// id, e o CPF sai do índice único parcial — a pessoa pode ser recadastrada.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Paciente inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("patients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, message: "Paciente não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/pacientes");
  return NextResponse.json({ ok: true, archived: true, message: "Paciente arquivado." });
}
