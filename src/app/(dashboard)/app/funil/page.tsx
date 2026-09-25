import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { FunnelBoard } from "@/features/leads/components/funnel-board";
import { getDeals } from "@/features/deals/queries/get-deals";
import { getTags } from "@/features/leads/queries/get-tags";
import { getBoardColumns } from "@/features/board/queries/get-board-columns";
import { getFunnelSettings } from "@/features/board/queries/get-funnel-settings";
import { getLeadAttributions } from "@/features/meta/queries/get-lead-attributions";
import { getProcedures } from "@/features/financeiro/queries/get-procedures";
import { getLeadSales } from "@/features/financeiro/queries/get-lead-sales";
import { CustomPipelineBoard } from "@/features/pipelines/components/custom-pipeline-board";
import { PipelineSwitcher } from "@/features/pipelines/components/pipeline-switcher";
import { getPipelineBoard } from "@/features/pipelines/queries/get-pipeline-board";
import { getPipelines } from "@/features/pipelines/queries/get-pipelines";
import { isLeadsPipeline } from "@/features/pipelines/types";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedId = firstParam(params.funil);

  // A lista de funis vem antes de tudo porque decide QUAL board carregar: sem
  // ela não dá para saber se `?funil=` aponta para o funil nativo (cards =
  // deals) ou para um personalizado (cards = pipeline_cards).
  const summaries = await getPipelines();
  const requested = requestedId
    ? (summaries.find((summary) => summary.pipeline.id === requestedId)?.pipeline ?? null)
    : null;
  // Só funil `custom` muda a tela. Sem parâmetro, parâmetro desconhecido ou
  // funil nativo caem no board de leads — o que a página já fazia.
  const custom = requested && !isLeadsPipeline(requested) ? requested : null;
  const board = custom ? await getPipelineBoard(custom.id) : null;

  const leadsPipeline =
    summaries.find((summary) => isLeadsPipeline(summary.pipeline))?.pipeline ?? null;
  const activeId = custom?.id ?? leadsPipeline?.id ?? null;

  return (
    // Ocupa a tela inteira: header fixo + board rolando só por dentro (sem scroll de página).
    <div className="flex h-[calc(100dvh-var(--app-chrome-top)-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col overflow-hidden lg:h-[calc(100dvh-var(--app-chrome-top))]">
      <PageHeader title="Funil" />
      <PipelineSwitcher
        pipelines={summaries.map(({ pipeline, cardCount }) => ({
          id: pipeline.id,
          name: pipeline.name,
          color: pipeline.color,
          cardCount,
        }))}
        activeId={activeId}
      />
      <main className="min-h-0 flex-1 overflow-hidden px-4 pt-4 pb-2 sm:px-6 lg:px-8">
        {custom ? (
          board ? (
            /*
              O diálogo de novo card é de outro escopo. Sem `onCreate` o board
              não desenha o botão — melhor não oferecer do que oferecer uma
              ação que não abre nada.
            */
            <CustomPipelineBoard pipelineId={board.pipeline.id} stages={board.stages} cards={board.cards} />
          ) : (
            <PipelineLoadError name={custom.name} />
          )
        ) : (
          <LeadsFunnel />
        )}
      </main>
    </div>
  );
}

/**
 * O funil nativo: etapas em `board_columns`, cards em `deals`, com atribuição
 * de anúncio, vendas e procedimentos. É exatamente o que a página carregava
 * antes dos funis personalizados existirem — nada aqui mudou de comportamento.
 */
async function LeadsFunnel() {
  const [deals, columns, tags, funnelSettings] = await Promise.all([
    getDeals(),
    getBoardColumns(),
    getTags(),
    getFunnelSettings(),
  ]);

  // Origem publicitária só existe para quem clicou em anúncio; a busca é feita
  // depois dos deals porque depende dos leads que entraram no board.
  const leadIds = deals
    .map((deal) => deal.lead?.id)
    .filter((id): id is string => Boolean(id));
  const [attributionsMap, salesMap, procedures] = await Promise.all([
    getLeadAttributions(leadIds),
    getLeadSales(leadIds),
    getProcedures(),
  ]);
  const attributions = Object.fromEntries(attributionsMap);
  const sales = Object.fromEntries(salesMap);

  return (
    <FunnelBoard
      deals={deals}
      columns={columns}
      tags={tags}
      attributions={attributions}
      procedures={procedures}
      sales={sales}
      showStageMeta={funnelSettings.showStageMeta}
    />
  );
}

/**
 * O funil existe na lista mas o board não veio. Cair no funil de leads em
 * silêncio seria pior: a tela mostraria outros cards sem dizer nada.
 */
function PipelineLoadError({ name }: { name: string }) {
  return (
    <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20 p-8 text-center">
      <div className="grid justify-items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <TriangleAlertIcon className="size-5" aria-hidden />
        </span>
        <div className="grid gap-1">
          <p className="font-display text-sm font-medium">
            Não foi possível carregar o funil “{name}”
          </p>
          <p className="max-w-xs text-xs leading-snug text-muted-foreground">
            Recarregue a página. Se continuar assim, confira as etapas do funil
            nas configurações.
          </p>
        </div>
        <Link
          href="/app/funil"
          className="flex h-9 items-center rounded-full border border-border/70 bg-card px-3.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Voltar ao funil de leads
        </Link>
      </div>
    </div>
  );
}
