import type { BoardColumn } from "@/features/board/types";
import type { Database } from "@/lib/supabase/types";

export type Pipeline = Database["public"]["Tables"]["pipelines"]["Row"];
export type PipelineCard = Database["public"]["Tables"]["pipeline_cards"]["Row"];

/**
 * Etapa de funil **é** `board_columns` — a mesma tabela que sempre desenhou o
 * funil nativo, agora com `pipeline_id`. O alias existe só para o vocabulário
 * da tela ("etapa do funil") não obrigar a importar `BoardColumn` em todo lugar;
 * duplicar o tipo criaria duas verdades sobre a mesma linha.
 */
export type PipelineStage = BoardColumn;

export const PIPELINE_KINDS = ["leads", "custom"] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

/**
 * O funil nativo: um só existe (índice único no banco), não pode ser apagado
 * nem trocar de `kind`, e os cards dele são `deals` — não `pipeline_cards`.
 */
export function isLeadsPipeline(pipeline: Pick<Pipeline, "kind">): boolean {
  return pipeline.kind === "leads";
}

/**
 * Erro do gatilho `pipeline_cards_check_stage`: card apontando para uma etapa
 * que não existe naquele funil. Chega como SQLSTATE 23514 com esta mensagem —
 * a rota traduz para 400 em português em vez de vazar texto de banco.
 */
export const MISSING_STAGE_ERROR = "etapa_inexistente_no_funil";

export function isMissingStageError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  return error.code === "23514" && (error.message ?? "").includes(MISSING_STAGE_ERROR);
}

/** Um funil aberto: o funil, as etapas em ordem e os cards ativos. */
export type PipelineBoard = {
  pipeline: Pipeline;
  stages: PipelineStage[];
  /**
   * Sempre vazio no funil nativo (`kind: "leads"`): lá os cards são `deals`,
   * carregados por `getDeals()` e desenhados pelo board antigo.
   */
  cards: PipelineCard[];
};

/** Linha da lista de funis (tela de configurações e seletor). */
export type PipelineSummary = {
  pipeline: Pipeline;
  stageCount: number;
  cardCount: number;
};
