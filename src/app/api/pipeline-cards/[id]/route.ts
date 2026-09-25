import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { updatePipelineCardSchema } from "@/features/pipelines/schemas/pipeline";
import { isMissingStageError } from "@/features/pipelines/types";
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
 * Edita o card — inclusive `stage` e `position`, que é o que o arraste do
 * kanban manda. A etapa de destino é validada pelo gatilho do banco contra as
 * colunas DO FUNIL do card; aqui só traduzimos a recusa para português.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Card inválido." }, { status: 400 });
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

  const parsed = updatePipelineCardSchema.safeParse(body);
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

  // Campo ausente = "não altere"; campo vazio já virou `null` no schema.
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined)
  ) as Database["public"]["Tables"]["pipeline_cards"]["Update"];

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Nada para atualizar." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: card, error } = await supabase
    .from("pipeline_cards")
    .update(patch)
    .eq("id", id)
    .is("archived_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingStageError(error)) {
      return NextResponse.json(
        {
          ok: false,
          message: "A etapa escolhida não existe neste funil.",
          errors: { stage: ["A etapa escolhida não existe neste funil."] },
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!card) {
    return NextResponse.json({ ok: false, message: "Card não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/funil");

  return NextResponse.json({ ok: true, card, message: "Card atualizado." });
}

/**
 * ARQUIVA o card — não apaga. O cartão sai do board e o histórico fica,
 * inclusive o vínculo com lead ou paciente, se houver.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Card inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pipeline_cards")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Card não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/funil");

  return NextResponse.json({ ok: true, archived: true, message: "Card arquivado." });
}
