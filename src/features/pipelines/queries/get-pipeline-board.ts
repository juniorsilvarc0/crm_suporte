import {
  isLeadsPipeline,
  type PipelineBoard,
  type PipelineCard,
} from "@/features/pipelines/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

const PAGE_SIZE = 1000;

/**
 * Um funil aberto: o funil, as etapas em ordem e os cards ativos.
 *
 * ⚠️ **Cards só existem para `kind: "custom"`.** No funil nativo (`kind:
 * "leads"`) esta consulta devolve `cards: []` de propósito: lá o card é um
 * `deal`, carregado por `getDeals()` e desenhado pelo board antigo
 * (`src/features/leads/components/funnel-board.tsx`), que arrasta, move o
 * status do lead e alimenta a conversão. Nada disso mora aqui — misturar as
 * duas fontes numa lista só duplicaria cards na tela.
 *
 * Devolve `null` quando o funil não existe (ou está arquivado): a página trata
 * isso como 404. Erro de banco também vira `null` e fica no log — leitura
 * resiliente (AGENTS §4).
 */
export async function getPipelineBoard(pipelineId: string): Promise<PipelineBoard | null> {
  if (!hasSupabaseServerEnv()) return null;

  try {
    const supabase = createSupabaseServerClient();

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .select("*")
      .eq("id", pipelineId)
      .is("archived_at", null)
      .maybeSingle();

    if (error) {
      console.error("getPipelineBoard failed", error.message);
      return null;
    }
    if (!pipeline) return null;

    const { data: stageRows, error: stageError } = await supabase
      .from("board_columns")
      .select("*")
      .eq("pipeline_id", pipeline.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (stageError) {
      console.error("getPipelineBoard stages failed", stageError.message);
    }

    const stages = stageRows ?? [];

    if (isLeadsPipeline(pipeline)) {
      return { pipeline, stages, cards: [] };
    }

    // Paginado como `getDeals`: o PostgREST corta em 1000 linhas por resposta,
    // e um funil de processos internos passa disso sem esforço.
    const cards: PipelineCard[] = [];
    let from = 0;

    while (true) {
      const { data, error: cardError } = await supabase
        .from("pipeline_cards")
        .select("*")
        .eq("pipeline_id", pipeline.id)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (cardError) {
        console.error("getPipelineBoard cards failed", cardError.message);
        return { pipeline, stages, cards: [] };
      }

      const page = data ?? [];
      cards.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return { pipeline, stages, cards };
  } catch (error) {
    console.error("getPipelineBoard threw", error);
    return null;
  }
}
