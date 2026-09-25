import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  buildStageKey,
  pipelineStagesSchema,
  type PipelineStageInput,
} from "@/features/pipelines/schemas/pipeline";
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

/** Etapa de entrada do funil nativo — o gatilho do banco recusa apagá-la. */
const ENTRY_STAGE_KEY = "novo";

type CurrentStage = {
  id: string;
  key: string;
  label: string;
  color: string;
  position: number;
  stage_type: string;
};

/**
 * Quantos cards a etapa ainda segura.
 *
 * ⚠️ `deals` é contado para os DOIS tipos de funil. O gatilho
 * `reassign_deals_before_board_column_delete` (migration de identidade de lead)
 * é anterior aos funis: ao apagar qualquer coluna ele move **todo** `deal` com
 * aquela `stage` para `novo`, sem olhar `pipeline_id`. Uma etapa personalizada
 * que por acaso tenha a mesma chave de uma etapa do funil de leads levaria os
 * cards de verdade junto — então ela também não pode ser removida enquanto
 * houver `deal` ativo naquela chave.
 */
async function countStageCards(
  supabase: SupabaseClient<Database>,
  args: { pipelineId: string; key: string }
): Promise<{ cards: number; deals: number }> {
  const [cardsRes, dealsRes] = await Promise.all([
    supabase
      .from("pipeline_cards")
      .select("*", { count: "exact", head: true })
      .eq("pipeline_id", args.pipelineId)
      .eq("stage", args.key)
      .is("archived_at", null),
    supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .eq("stage", args.key)
      .is("removed_at", null),
  ]);

  return { cards: cardsRes.count ?? 0, deals: dealsRes.count ?? 0 };
}

/**
 * Substitui a lista de etapas do funil.
 *
 * A tela edita as etapas como um bloco só (mesma ideia da grade de horários em
 * `/api/agenda/hours`): chega a lista final, e a rota descobre o que criar,
 * atualizar e remover. Sem transação de banco disponível pelo supabase-js, a
 * ordem das operações é o que garante que nada fica pela metade:
 *
 * 1. **valida tudo antes de escrever** — inclusive as remoções, que são
 *    recusadas enquanto houver card na etapa;
 * 2. atualiza e cria (o funil nunca fica sem coluna);
 * 3. remove por último.
 *
 * Se a remoção falhar no fim, o funil continua íntegro: sobra uma etapa a mais,
 * não uma etapa a menos com cards órfãos.
 */
export async function PUT(
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

  const parsed = pipelineStagesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise as etapas.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();

  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .select("id, kind, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (pipelineError) {
    return NextResponse.json({ ok: false, message: pipelineError.message }, { status: 500 });
  }
  if (!pipeline || pipeline.archived_at) {
    return NextResponse.json({ ok: false, message: "Funil não encontrado." }, { status: 404 });
  }

  const { data: currentRows, error: currentError } = await supabase
    .from("board_columns")
    .select("id, key, label, color, position, stage_type")
    .eq("pipeline_id", id);

  if (currentError) {
    return NextResponse.json({ ok: false, message: currentError.message }, { status: 500 });
  }

  const current = (currentRows ?? []) as CurrentStage[];
  const currentById = new Map(current.map((stage) => [stage.id, stage]));
  const incoming = parsed.data.stages;

  // Etapa de outro funil não entra: a `key` só vale dentro do funil dela.
  const foreign = incoming.find((stage) => stage.id && !currentById.has(stage.id));
  if (foreign) {
    return NextResponse.json(
      { ok: false, message: "Uma das etapas enviadas não pertence a este funil." },
      { status: 400 }
    );
  }

  const keptIds = new Set(
    incoming.map((stage) => stage.id).filter((stageId): stageId is string => Boolean(stageId))
  );
  const removed = current.filter((stage) => !keptIds.has(stage.id));

  for (const stage of removed) {
    if (stage.key === ENTRY_STAGE_KEY) {
      return NextResponse.json(
        {
          ok: false,
          message: `A etapa de entrada ("${stage.label}") não pode ser removida — é para onde os cards voltam.`,
        },
        { status: 409 }
      );
    }

    const { cards, deals } = await countStageCards(supabase, {
      pipelineId: pipeline.id,
      key: stage.key,
    });
    const own = pipeline.kind === "leads" ? deals : cards;

    if (own > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: `A etapa "${stage.label}" ainda tem ${own} ${own === 1 ? "card" : "cards"}. Mova ${own === 1 ? "o card" : "os cards"} para outra etapa antes de removê-la.`,
        },
        { status: 409 }
      );
    }

    if (pipeline.kind !== "leads" && deals > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: `A etapa "${stage.label}" usa a chave "${stage.key}", a mesma de uma etapa do funil de leads que tem ${deals} ${deals === 1 ? "card ativo" : "cards ativos"}. Removê-la moveria aqueles cards — renomeie a etapa em vez de removê-la.`,
        },
        { status: 409 }
      );
    }
  }

  // Chaves em uso, incluindo as das etapas que vão sair: a remoção acontece
  // DEPOIS das inserções, e o índice único é (pipeline_id, key).
  const taken = new Set(current.map((stage) => stage.key));

  const toUpdate: { id: string; patch: Database["public"]["Tables"]["board_columns"]["Update"] }[] = [];
  const toInsert: Database["public"]["Tables"]["board_columns"]["Insert"][] = [];

  incoming.forEach((stage: PipelineStageInput, index) => {
    const existing = stage.id ? currentById.get(stage.id) : undefined;

    if (!existing) {
      toInsert.push({
        pipeline_id: pipeline.id,
        key: buildStageKey(stage.label, taken),
        label: stage.label,
        color: stage.color,
        position: index,
        stage_type: stage.stage_type,
      });
      return;
    }

    // Só o que mudou é gravado. Um UPDATE de `position` ou `stage_type` dispara
    // `reproject_leads_from_board_change`, que varre TODO lead com deal ativo —
    // regravar valor igual custaria essa varredura por etapa, à toa.
    const patch: Database["public"]["Tables"]["board_columns"]["Update"] = {};
    if (existing.label !== stage.label) patch.label = stage.label;
    if (existing.color !== stage.color) patch.color = stage.color;
    if (existing.position !== index) patch.position = index;
    if (existing.stage_type !== stage.stage_type) patch.stage_type = stage.stage_type;

    // ⚠️ A `key` NÃO é re-derivada do rótulo: os cards apontam para ela, e
    // renomear "Em análise" mudaria a chave, deixando cada card numa coluna
    // que não existe mais.
    if (Object.keys(patch).length > 0) toUpdate.push({ id: existing.id, patch });
  });

  for (const item of toUpdate) {
    const { error } = await supabase.from("board_columns").update(item.patch).eq("id", item.id);
    if (error) {
      return NextResponse.json(
        { ok: false, message: `Não foi possível salvar as etapas: ${error.message}` },
        { status: 500 }
      );
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("board_columns").insert(toInsert);
    if (error) {
      return NextResponse.json(
        { ok: false, message: `Não foi possível criar as etapas novas: ${error.message}` },
        { status: 500 }
      );
    }
  }

  if (removed.length > 0) {
    const { error } = await supabase
      .from("board_columns")
      .delete()
      .in(
        "id",
        removed.map((stage) => stage.id)
      );

    if (error) {
      // 23514 aqui é o gatilho do banco recusando a exclusão (etapa de entrada).
      const blocked = error.code === "23514";
      return NextResponse.json(
        {
          ok: false,
          message: blocked
            ? "O banco recusou remover uma das etapas. Mova os cards e tente de novo."
            : `Não foi possível remover as etapas: ${error.message}`,
        },
        { status: blocked ? 409 : 500 }
      );
    }
  }

  const { data: stages, error: finalError } = await supabase
    .from("board_columns")
    .select("*")
    .eq("pipeline_id", pipeline.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (finalError) {
    return NextResponse.json({ ok: false, message: finalError.message }, { status: 500 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/configuracoes");

  return NextResponse.json({ ok: true, stages: stages ?? [], message: "Etapas salvas." });
}
