import { ratioPercentage } from "@/lib/formatters/percentage";

/**
 * Funil de conversão da coorte Meta e cruzamento com o investimento.
 *
 * Módulo **puro**: nada aqui toca Supabase, Graph API ou React. É o que permite
 * testar as duas regras que costumam sair erradas — a monotonicidade do funil e
 * o denominador do custo por lead.
 */

export type FunnelStageDefinition = {
  key: string;
  label: string;
  position: number;
};

export type FunnelStageRow = FunnelStageDefinition & {
  leads: number;
  /** Percentual sobre o topo do funil (os contatos da coorte). */
  shareOfTop: number;
  /** Percentual sobre a etapa anterior. `null` no topo, que não tem anterior. */
  stepConversion: number | null;
};

export type ConversionFunnel = {
  contacts: number;
  stages: FunnelStageRow[];
  /** Leads da coorte cuja etapa atual é uma coluna `lost`. Fora do funil. */
  lost: number;
};

/** Coluna do board, no mínimo que este módulo precisa enxergar. */
export type FunnelColumn = {
  key: string;
  label: string;
  position: number;
  stage_type: string | null;
  counts_as_conversion: boolean | null;
};

export const DEFAULT_QUALIFIED_STAGE_KEY = "qualificado";

/**
 * Quais colunas do board viram etapa do funil.
 *
 * Regra derivada da configuração, **não** lista fixa no código: coluna marcada
 * como `counts_as_conversion`, mais a coluna de qualificação. Se a clínica
 * marcar outra coluna como conversão, ela aparece aqui sozinha.
 *
 * ⚠️ **A ordem é `position`, a mesma do board.** As filas de operador ("Em
 * atendimento BRUNA/DEBORA") ficam configuradas ACIMA de Qualificado, então um
 * lead numa fila conta como tendo passado por Qualificado. Isso não é palpite
 * deste código: é a ordem que a clínica arrastou no funil, e arrastar a coluna
 * lá muda o resultado aqui.
 *
 * Coluna `lost` nunca entra — perda não é etapa de avanço, é saída.
 */
export function resolveFunnelStages(
  columns: readonly FunnelColumn[],
  qualifiedStageKey: string = DEFAULT_QUALIFIED_STAGE_KEY
): FunnelStageDefinition[] {
  return columns
    .filter((column) => column.stage_type !== "lost")
    .filter(
      (column) => column.counts_as_conversion === true || column.key === qualifiedStageKey
    )
    .map((column) => ({
      key: column.key,
      label: column.label,
      position: column.position,
    }))
    .sort((a, b) => a.position - b.position);
}

/** Posição de cada etapa que pode ser alcançada. Colunas `lost` ficam de fora. */
export function buildStagePositionIndex(
  columns: readonly FunnelColumn[]
): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  for (const column of columns) {
    if (column.stage_type === "lost") continue;
    index.set(column.key, column.position);
  }
  return index;
}

/**
 * A posição mais avançada que o lead alcançou, ou `-1` se nenhuma etapa
 * conhecida foi tocada.
 *
 * ⚠️ **É isto, e não "tocou a etapa", que sustenta o funil.** Medido em
 * produção: 2 leads da coorte chegaram a `agendado` sem nunca passar por
 * `em_atendimento`. Contando toque, a etapa de baixo teria leads que não estão
 * na de cima, o funil deixaria de ser monotônico e a conversão entre etapas
 * consecutivas passaria de 100%.
 *
 * Etapa desconhecida (coluna renomeada ou apagada) é ignorada em vez de derrubar
 * o cálculo: histórico antigo não pode sumir com o número de hoje.
 */
export function furthestStagePosition(
  stageKeys: Iterable<string>,
  positionByStage: ReadonlyMap<string, number>
): number {
  let furthest = -1;
  for (const key of stageKeys) {
    const position = positionByStage.get(key);
    if (position !== undefined && position > furthest) furthest = position;
  }
  return furthest;
}

export function buildConversionFunnel({
  stages,
  furthestPositions,
  lost = 0,
}: {
  stages: readonly FunnelStageDefinition[];
  /** Uma entrada por lead da coorte: a posição mais avançada que ele alcançou. */
  furthestPositions: readonly number[];
  lost?: number;
}): ConversionFunnel {
  const contacts = furthestPositions.length;
  let previous = contacts;

  const rows = stages.map((stage) => {
    const leads = furthestPositions.filter((position) => position >= stage.position).length;
    const row: FunnelStageRow = {
      ...stage,
      leads,
      shareOfTop: ratioPercentage(leads, contacts),
      stepConversion: ratioPercentage(leads, previous),
    };
    previous = leads;
    return row;
  });

  return { contacts, stages: rows, lost };
}

/**
 * Separa as etapas que alguém alcançou das que continuam vazias **no fim**.
 *
 * Uma etapa zerada no MEIO fica visível: ali o zero é informação (o funil pulou
 * aquela etapa). No fim é só "ainda não aconteceu", e três linhas idênticas
 * dizendo "0 · 0%" ocupavam um terço do cartão sem informar nada.
 */
export function splitTrailingEmptyStages(stages: readonly FunnelStageRow[]) {
  let cut = stages.length;
  while (cut > 0 && stages[cut - 1].leads === 0) cut -= 1;
  return { reached: stages.slice(0, cut), pending: stages.slice(cut) };
}

/** "Compareceu, Cliente e Recorrente" — com "e" antes do último, como se fala. */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

// ─── Cruzamento com o investimento ──────────────────────────────────────────

export type CohortAd = {
  adId: string | null;
  /** Leads distintos da coorte cujo primeiro toque veio deste anúncio. */
  leads: number;
};

export type SpendSummary = {
  /** Gasto dos anúncios que geraram lead na coorte. É o denominador do custo. */
  attributedSpend: number;
  /** Gasto de anúncios que rodaram no período e não geraram lead atribuído. */
  unattributedSpend: number;
  unattributedAds: number;
  /** Leads vindos de anúncio sem veiculação no período — clique antigo. */
  leadsWithoutSpend: number;
  /** Conversas iniciadas segundo a própria Meta, nos anúncios com lead. */
  metaMessagingStarted: number;
};

export type AdSpend = {
  adId: string;
  spend: number;
  messagingStarted: number;
};

/**
 * Separa o gasto do período em "gerou lead" e "não gerou".
 *
 * ⚠️ **Os dois desencontros são reais e acontecem nos dois sentidos.** Medido em
 * 06–12/08: R$ 222,35 numa campanha de tráfego sem nenhum lead atribuído, e 2
 * leads vindos de anúncios pausados, sem veiculação no período. Somar tudo num
 * número só esconderia as duas coisas — e as duas mudam a leitura do custo.
 */
export function summarizeSpend(
  cohortAds: readonly CohortAd[],
  insights: readonly AdSpend[]
): SpendSummary {
  const leadsByAd = new Map<string, number>();
  let leadsWithoutAd = 0;
  for (const ad of cohortAds) {
    if (!ad.adId) {
      leadsWithoutAd += ad.leads;
      continue;
    }
    leadsByAd.set(ad.adId, (leadsByAd.get(ad.adId) ?? 0) + ad.leads);
  }

  const summary: SpendSummary = {
    attributedSpend: 0,
    unattributedSpend: 0,
    unattributedAds: 0,
    leadsWithoutSpend: leadsWithoutAd,
    metaMessagingStarted: 0,
  };

  const seen = new Set<string>();
  for (const insight of insights) {
    seen.add(insight.adId);
    if (leadsByAd.has(insight.adId)) {
      summary.attributedSpend += insight.spend;
      summary.metaMessagingStarted += insight.messagingStarted;
      continue;
    }
    // Anúncio sem lead não some da conta: aparece como linha à parte.
    summary.unattributedSpend += insight.spend;
    summary.unattributedAds += 1;
  }

  for (const [adId, leads] of leadsByAd) {
    if (!seen.has(adId)) summary.leadsWithoutSpend += leads;
  }

  return summary;
}

/**
 * Custo por unidade. `null` quando não há o que dividir — mostrar "R$ 0" para
 * zero paciente seria dizer que o paciente saiu de graça.
 */
export function costPer(spend: number, count: number): number | null {
  if (count <= 0 || spend <= 0) return null;
  return spend / count;
}
