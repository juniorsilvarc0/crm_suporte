import { costPer } from "@/features/meta/funnel";
import type { MetaAdInsight } from "@/features/meta/insights";
import type { MetaCohortLead } from "@/features/meta/report";

/**
 * Custo por campanha, conjunto ou anúncio.
 *
 * Módulo **puro**: cruza o gasto que veio da Meta com o desfecho que veio do
 * CRM. A chave do cruzamento é `ad_id` — `MetaAdInsight.adId` **é**
 * `meta_attributions.ad_id_snapshot`, sem tradução no meio.
 *
 * ⚠️ **Os dois lados desencontram, e nos dois sentidos.** Anúncio que gastou e
 * não trouxe ninguém, e contato vindo de anúncio que não estava no ar (clicou
 * antes). Nenhum dos dois pode sumir da tabela: o primeiro é a linha que
 * justifica cortar verba, o segundo explica por que a soma dos contatos não
 * bate com a soma dos anúncios veiculados.
 */

export type CostLevel = "campaign" | "adset" | "ad";

export type CostRow = {
  /** Identidade dentro do nível. Sintética nos dois grupos residuais. */
  id: string;
  name: string;
  /** `null` quando não há gasto conhecido — não é o mesmo que R$ 0,00. */
  spend: number | null;
  contacts: number;
  scheduled: number;
  patients: number;
  costPerContact: number | null;
  costPerPatient: number | null;
  /**
   * `true` quando a linha só existe do lado do CRM: houve contato, mas nenhum
   * anúncio correspondente foi veiculado no período.
   */
  spendMissing: boolean;
};

/**
 * Linhas sintéticas. Existem para que nenhum contato seja somado a uma campanha
 * que não é a dele — jogar "sem identificação" dentro de uma campanha real
 * inflaria o desempenho dela.
 */
export const UNKNOWN_ROW_ID = "__sem_identificacao__";
export const UNKNOWN_ROW_LABEL = "Sem identificação";

type Bucket = {
  id: string;
  name: string;
  spend: number;
  hasSpend: boolean;
  contacts: number;
  scheduled: number;
  patients: number;
};

function keyOf(lead: MetaCohortLead, level: CostLevel) {
  if (level === "campaign") {
    return { id: lead.campaignId, name: lead.campaignName };
  }
  if (level === "adset") {
    return { id: lead.adsetId, name: lead.adsetName };
  }
  return { id: lead.adId, name: lead.adName };
}

function keyOfInsight(ad: MetaAdInsight, level: CostLevel) {
  if (level === "campaign") {
    return { id: ad.campaignId, name: ad.campaignName };
  }
  if (level === "adset") {
    return { id: ad.adsetId, name: ad.adsetName };
  }
  return { id: ad.adId, name: ad.adName };
}

function bucketFor(
  buckets: Map<string, Bucket>,
  id: string | null,
  name: string | null
): Bucket {
  const key = id ?? UNKNOWN_ROW_ID;
  const existing = buckets.get(key);
  if (existing) {
    // Nome do lado que tiver: a Meta conhece o anúncio veiculado, o CRM conhece
    // o anúncio pausado. Nenhum dos dois sozinho nomeia a tabela inteira.
    //
    // ⚠️ `id` precisa existir. Sem a guarda, um lead com anúncio nulo mas nome
    // preenchido rebatizava a linha "Sem identificação" com o nome dele — e
    // aquela linha passaria a parecer um anúncio real.
    if (id && existing.name === UNKNOWN_ROW_LABEL && name) existing.name = name;
    return existing;
  }
  const created: Bucket = {
    id: key,
    name: (id ? name : null) ?? UNKNOWN_ROW_LABEL,
    spend: 0,
    hasSpend: false,
    contacts: 0,
    scheduled: 0,
    patients: 0,
  };
  buckets.set(key, created);
  return created;
}

/**
 * Uma linha por campanha, conjunto ou anúncio, ordenada por gasto.
 *
 * Ordem: quem consumiu mais verba primeiro; empate desempata por contatos e
 * depois por nome. Linha sem gasto conhecido vai para o fim — ela explica um
 * desencontro, não sustenta decisão de verba.
 */
export function buildCostRows(
  cohort: readonly MetaCohortLead[],
  insights: readonly MetaAdInsight[],
  level: CostLevel
): CostRow[] {
  const buckets = new Map<string, Bucket>();

  // O gasto entra primeiro para que anúncio sem nenhum contato exista como
  // linha. É justamente a linha que some quando a tabela é montada a partir dos
  // leads — e é a que responde "onde estou queimando dinheiro à toa".
  for (const ad of insights) {
    const { id, name } = keyOfInsight(ad, level);
    const bucket = bucketFor(buckets, id, name);
    bucket.spend += ad.spend;
    bucket.hasSpend = true;
  }

  for (const lead of cohort) {
    const { id, name } = keyOf(lead, level);
    const bucket = bucketFor(buckets, id, name);
    bucket.contacts += 1;
    if (lead.scheduled) bucket.scheduled += 1;
    if (lead.patient) bucket.patients += 1;
  }

  return [...buckets.values()]
    .map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      spend: bucket.hasSpend ? bucket.spend : null,
      contacts: bucket.contacts,
      scheduled: bucket.scheduled,
      patients: bucket.patients,
      costPerContact: costPer(bucket.spend, bucket.contacts),
      costPerPatient: costPer(bucket.spend, bucket.patients),
      // ⚠️ A linha "Sem identificação" fica de fora: ali o problema não é que o
      // anúncio não veiculou, é que não se sabe qual anúncio foi. Marcá-la como
      // "sem veiculação" afirmaria uma coisa que ninguém verificou.
      spendMissing:
        !bucket.hasSpend && bucket.contacts > 0 && bucket.id !== UNKNOWN_ROW_ID,
    }))
    .sort(
      (a, b) =>
        (b.spend ?? -1) - (a.spend ?? -1) ||
        b.contacts - a.contacts ||
        a.name.localeCompare(b.name, "pt-BR")
    );
}

export type CostTotals = {
  spend: number;
  contacts: number;
  scheduled: number;
  patients: number;
  costPerContact: number | null;
  costPerPatient: number | null;
};

/**
 * O rodapé da tabela.
 *
 * ⚠️ **O total é a soma das linhas exibidas, incluindo o gasto que não gerou
 * contato.** Somar só o gasto atribuído daria um total que não fecha com a
 * coluna acima, e a pessoa passaria a conferir a conta em vez de ler o
 * resultado. Por isso o custo por contato do rodapé é maior que o da tela de
 * Visão geral — lá o denominador é o gasto que gerou contato, aqui é o gasto
 * inteiro do período.
 */
export function sumCostRows(rows: readonly CostRow[]): CostTotals {
  const totals = rows.reduce(
    (sum, row) => {
      sum.spend += row.spend ?? 0;
      sum.contacts += row.contacts;
      sum.scheduled += row.scheduled;
      sum.patients += row.patients;
      return sum;
    },
    { spend: 0, contacts: 0, scheduled: 0, patients: 0 }
  );

  return {
    ...totals,
    costPerContact: costPer(totals.spend, totals.contacts),
    costPerPatient: costPer(totals.spend, totals.patients),
  };
}

/**
 * Contatos por dia, a partir do primeiro toque de cada lead da coorte.
 *
 * A data sai do ISO cortado em `T`, e não de `new Date(...).toISOString()`: o
 * ISO do banco está no fuso da clínica e converter para UTC empurraria para o
 * dia anterior tudo que chegou depois das 21 h — foi exatamente essa conversão
 * que já fez três leads caírem fora da janela numa conferência anterior.
 */
export function contactsByDay(
  cohort: readonly MetaCohortLead[]
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const lead of cohort) {
    const day = lead.firstTouchAt.slice(0, 10);
    if (day.length !== 10) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return byDay;
}

export type PeriodPoint = { date: string; spend: number; contacts: number };

/**
 * A série do gráfico: um ponto por dia do intervalo, inclusive os dias em que
 * nada aconteceu.
 *
 * Pular o dia vazio faz o eixo mentir — 3 dias sem gasto viram um degrau que
 * parece contínuo. O intervalo é percorrido como texto `YYYY-MM-DD` somando dia
 * a dia em UTC, o que é seguro porque as datas já vêm normalizadas do filtro.
 */
export function buildPeriodSeries({
  from,
  to,
  daily,
  cohort,
}: {
  from: string;
  to: string;
  daily: ReadonlyArray<{ date: string; spend: number }>;
  cohort: readonly MetaCohortLead[];
}): PeriodPoint[] {
  const spendByDay = new Map(daily.map((point) => [point.date, point.spend]));
  const contacts = contactsByDay(cohort);

  const points: PeriodPoint[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return points;

  // Teto de segurança: intervalo absurdo vindo da URL não vira laço infinito.
  for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
    const date = cursor.toISOString().slice(0, 10);
    points.push({
      date,
      spend: spendByDay.get(date) ?? 0,
      contacts: contacts.get(date) ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}
