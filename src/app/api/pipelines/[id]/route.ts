import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { updatePipelineSchema } from "@/features/pipelines/schemas/pipeline";
import { isLeadsPipeline } from "@/features/pipelines/types";
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
 * O funil nativo é a âncora do que já roda: os cards dele são `deals`, e o
 * nome aparece em tela, em relatório e no vocabulário da equipe. Renomear ou
 * arquivar é recusado — não escondido na interface, recusado no servidor.
 */
const NATIVE_PIPELINE_MESSAGE =
  "O funil de leads é nativo do sistema: ele não pode ser renomeado nem arquivado.";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Funil inválido." }, { status: 400 });
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

  const parsed = updatePipelineSchema.safeParse(body);
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
  const { data: current, error: currentError } = await supabase
    .from("pipelines")
    .select("id, name, kind, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (currentError) {
    return NextResponse.json({ ok: false, message: currentError.message }, { status: 500 });
  }
  if (!current || current.archived_at) {
    return NextResponse.json({ ok: false, message: "Funil não encontrado." }, { status: 404 });
  }

  // Campo ausente = "não altere"; campo vazio já virou `null` no schema.
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  ) as Database["public"]["Tables"]["pipelines"]["Update"];

  if (isLeadsPipeline(current)) {
    // Reenviar o mesmo nome (formulário que manda a tela inteira) não é
    // renomear — só o nome DIFERENTE é recusado.
    if (patch.name !== undefined && patch.name !== current.name) {
      return NextResponse.json({ ok: false, message: NATIVE_PIPELINE_MESSAGE }, { status: 409 });
    }
    delete patch.name;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Nada para atualizar." }, { status: 400 });
  }

  const { data: pipeline, error } = await supabase
    .from("pipelines")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!pipeline) {
    return NextResponse.json({ ok: false, message: "Funil não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/configuracoes");

  return NextResponse.json({ ok: true, pipeline, message: "Funil atualizado." });
}

/**
 * ARQUIVA o funil — não apaga.
 *
 * `delete` levaria junto as etapas e os cards por cascade, sem volta. Arquivar
 * tira o funil da lista e mantém o histórico de pé.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Funil inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: current, error: currentError } = await supabase
    .from("pipelines")
    .select("id, kind, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (currentError) {
    return NextResponse.json({ ok: false, message: currentError.message }, { status: 500 });
  }
  if (!current || current.archived_at) {
    return NextResponse.json({ ok: false, message: "Funil não encontrado." }, { status: 404 });
  }
  if (isLeadsPipeline(current)) {
    return NextResponse.json({ ok: false, message: NATIVE_PIPELINE_MESSAGE }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("pipelines")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Funil não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/configuracoes");

  return NextResponse.json({ ok: true, archived: true, message: "Funil arquivado." });
}
