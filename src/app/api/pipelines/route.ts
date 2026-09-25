import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  DEFAULT_PIPELINE_STAGES,
  buildStageKey,
  createPipelineSchema,
} from "@/features/pipelines/schemas/pipeline";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Cria um funil personalizado (`kind: "custom"`) já com etapas.
 *
 * `kind` nunca vem do cliente: o funil nativo é único (índice único no banco) e
 * existe desde a migration. Todo funil criado aqui é personalizado.
 *
 * As etapas entram no mesmo pedido de propósito — funil sem etapa é funil
 * quebrado: o gatilho `pipeline_cards_check_stage` recusa qualquer card e a
 * tela não teria coluna para desenhar. Sem lista própria, valem as três etapas
 * genéricas de `DEFAULT_PIPELINE_STAGES`.
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

  const { data: body, error: bodyError } = await readJsonBody(request);
  if (bodyError) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = createPipelineSchema.safeParse(body);
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

  // Entra no fim da fileira de funis.
  const { data: last } = await supabase
    .from("pipelines")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: pipeline, error } = await supabase
    .from("pipelines")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color,
      kind: "custom",
      position: (last?.position ?? -1) + 1,
      created_by_user_id: auth.viewer.id,
    })
    .select("*")
    .single();

  if (error || !pipeline) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Não foi possível criar o funil." },
      { status: 500 }
    );
  }

  const requested: { label: string; color: string; stage_type: string }[] =
    parsed.data.stages && parsed.data.stages.length > 0
      ? parsed.data.stages
      : DEFAULT_PIPELINE_STAGES;

  // O funil é novo: nenhuma chave existe ainda, só é preciso não repetir dentro
  // da própria lista (a chave é única POR funil).
  const taken = new Set<string>();
  const { data: stages, error: stageError } = await supabase
    .from("board_columns")
    .insert(
      requested.map((stage, index) => ({
        pipeline_id: pipeline.id,
        key: buildStageKey(stage.label, taken),
        label: stage.label,
        color: stage.color,
        position: index,
        stage_type: stage.stage_type,
      }))
    )
    .select("*");

  if (stageError) {
    // Funil sem etapa nenhuma não serve para nada e ainda apareceria na lista.
    // Ele acabou de nascer — desfazer aqui não perde dado de ninguém.
    await supabase.from("pipelines").delete().eq("id", pipeline.id);
    return NextResponse.json(
      { ok: false, message: "Não foi possível criar as etapas do funil." },
      { status: 500 }
    );
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/configuracoes");

  return NextResponse.json({
    ok: true,
    pipeline,
    stages: stages ?? [],
    message: "Funil criado.",
  });
}
