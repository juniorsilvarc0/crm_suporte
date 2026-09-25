import type { SupabaseClient } from "@supabase/supabase-js";

import { isLeadsPipeline, type Pipeline, type PipelineSummary } from "@/features/pipelines/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * Quantos cards ativos o funil tem.
 *
 * ⚠️ A contagem muda de tabela conforme o tipo: o funil nativo (`kind: "leads"`)
 * não usa `pipeline_cards` — os cards dele são `deals`, com toda a mecânica de
 * conversão pendurada. Contar `pipeline_cards` ali devolveria zero para o funil
 * mais cheio da clínica.
 *
 * `head: true` = só o COUNT vem do banco, nenhuma linha trafega, e o número não
 * fica preso ao teto de linhas do PostgREST.
 */
async function countPipelineCards(
  supabase: SupabaseClient<Database>,
  pipeline: Pipeline
): Promise<number> {
  if (isLeadsPipeline(pipeline)) {
    // Oportunidades vivas: `removed_at` nulo é o mesmo filtro de `getDeals`.
    const { count, error } = await supabase
      .from("deals")
      .select("*", { count: "exact", head: true })
      .is("removed_at", null);
    if (error) {
      console.error("countPipelineCards deals failed", error.message);
      return 0;
    }
    return count ?? 0;
  }

  const { count, error } = await supabase
    .from("pipeline_cards")
    .select("*", { count: "exact", head: true })
    .eq("pipeline_id", pipeline.id)
    .is("archived_at", null);
  if (error) {
    console.error("countPipelineCards failed", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Funis vivos, na ordem em que a tela os mostra, com etapas e cards contados.
 *
 * Leitura resiliente (AGENTS §4): erro loga e devolve lista vazia em vez de
 * derrubar a tela de configurações ou o seletor do funil.
 */
export async function getPipelines(): Promise<PipelineSummary[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .is("archived_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("getPipelines failed", error.message);
      return [];
    }

    const pipelines = data ?? [];
    if (pipelines.length === 0) return [];

    // As etapas de todos os funis cabem numa consulta só (dezenas de linhas);
    // os cards, não — por isso ali é COUNT por funil.
    const { data: stageRows, error: stageError } = await supabase
      .from("board_columns")
      .select("pipeline_id");

    if (stageError) {
      console.error("getPipelines stages failed", stageError.message);
    }

    const stageCounts = new Map<string, number>();
    for (const row of stageRows ?? []) {
      stageCounts.set(row.pipeline_id, (stageCounts.get(row.pipeline_id) ?? 0) + 1);
    }

    const cardCounts = await Promise.all(
      pipelines.map((pipeline) => countPipelineCards(supabase, pipeline))
    );

    return pipelines.map((pipeline, index) => ({
      pipeline,
      stageCount: stageCounts.get(pipeline.id) ?? 0,
      cardCount: cardCounts[index] ?? 0,
    }));
  } catch (error) {
    console.error("getPipelines threw", error);
    return [];
  }
}
