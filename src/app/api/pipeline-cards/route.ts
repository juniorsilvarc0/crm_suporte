import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createPipelineCardSchema } from "@/features/pipelines/schemas/pipeline";
import { isLeadsPipeline, isMissingStageError } from "@/features/pipelines/types";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Cria um card num funil personalizado.
 *
 * Lead e paciente são opcionais: card de processo interno não tem pessoa —
 * quem identifica o cartão é o título.
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

  const parsed = createPipelineCardSchema.safeParse(body);
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

  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .select("id, kind, archived_at")
    .eq("id", parsed.data.pipeline_id)
    .maybeSingle();

  if (pipelineError) {
    return NextResponse.json({ ok: false, message: pipelineError.message }, { status: 500 });
  }
  if (!pipeline || pipeline.archived_at) {
    return NextResponse.json({ ok: false, message: "Funil não encontrado." }, { status: 404 });
  }
  if (isLeadsPipeline(pipeline)) {
    // No funil nativo o card é um `deal`, com lead obrigatório e toda a
    // mecânica de conversão pendurada. Criar um `pipeline_card` ali produziria
    // um cartão que nenhuma tela desenha.
    return NextResponse.json(
      {
        ok: false,
        message: "No funil de leads o card é uma oportunidade do lead — crie por /api/deals.",
      },
      { status: 409 }
    );
  }

  // Entra no fim da coluna.
  const { data: last } = await supabase
    .from("pipeline_cards")
    .select("position")
    .eq("pipeline_id", pipeline.id)
    .eq("stage", parsed.data.stage)
    .is("archived_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: card, error } = await supabase
    .from("pipeline_cards")
    .insert({
      ...parsed.data,
      position: (last?.position ?? -1) + 1,
      created_by_user_id: auth.viewer.id,
    })
    .select("*")
    .single();

  if (error || !card) {
    // O gatilho do banco recusa etapa que não existe NESTE funil.
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
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Não foi possível criar o card." },
      { status: 500 }
    );
  }

  revalidatePath("/app/funil");

  return NextResponse.json({ ok: true, card, message: "Card criado." });
}
