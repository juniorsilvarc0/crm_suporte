import { z } from "zod";

import { getMetaRuntimeConfig } from "@/features/meta/config";
import { fetchWithTimeout } from "@/features/meta/graph";

/**
 * Investimento e entrega por anúncio, lidos ao vivo na Marketing API.
 *
 * `META-LEAD-TRACKING.md` §3.2 excluía CPL/CAC **"sem uma fonte de custos"**.
 * Esta é a fonte: o mesmo token que já enriquece anúncio (System User, escopo
 * `ads_read`) também lê `insights`.
 *
 * ⚠️ **Não existe tabela de gasto, e é de propósito.** A Meta reafirma `spend`
 * por até 28 dias; um snapshot no banco viraria uma segunda verdade que diverge
 * da primeira e ninguém saberia qual está certa. O número vem sempre da origem.
 */
export type MetaAdInsight = {
  adId: string;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  /**
   * Conversas iniciadas contadas pela **própria Meta** (janela de 7 dias).
   * Serve de contraprova do cruzamento: se divergir do CRM por ordem de
   * grandeza, o join por `ad_id` quebrou.
   */
  messagingStarted: number;
};

/**
 * `nao_configurado` é estado esperado (ambiente sem token/conta), não falha.
 * A tela distingue os dois: "falta configurar" pede ação diferente de
 * "a Meta não respondeu".
 */
export type MetaInsightsFailure = "nao_configurado" | "erro_meta";

/** Gasto de um dia, somado entre todos os anúncios da conta. */
export type MetaDailySpend = {
  /** `YYYY-MM-DD` no fuso da conta de anúncios. */
  date: string;
  spend: number;
};

export type MetaInsightsResult =
  | { ok: true; ads: MetaAdInsight[]; daily: MetaDailySpend[] }
  | { ok: false; reason: MetaInsightsFailure };

const actionSchema = z.object({
  action_type: z.string(),
  value: z.union([z.string(), z.number()]).optional(),
});

// A Graph devolve número como string ("251.17", "11741"). Nada de `z.number()`.
const insightRowSchema = z.object({
  date_start: z.string().optional(),
  ad_id: z.string(),
  ad_name: z.string().optional(),
  adset_id: z.string().optional(),
  adset_name: z.string().optional(),
  campaign_id: z.string().optional(),
  campaign_name: z.string().optional(),
  spend: z.union([z.string(), z.number()]).optional(),
  impressions: z.union([z.string(), z.number()]).optional(),
  clicks: z.union([z.string(), z.number()]).optional(),
  actions: z.array(actionSchema).optional(),
});

const insightsPageSchema = z.object({
  data: z.array(z.unknown()),
  paging: z.object({ next: z.string().optional() }).optional(),
});

const MESSAGING_STARTED = "onsite_conversion.messaging_conversation_started_7d";
const FIELDS = [
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "clicks",
  "actions",
].join(",");

// Teto de páginas: a conta tem 13 anúncios hoje, mas com `time_increment=1` são
// 13 × dias do recorte. 90 dias = 1.170 linhas = 3 páginas. O teto existe para
// que uma conta grande não vire laço infinito dentro de um render.
const MAX_PAGES = 20;
const PAGE_SIZE = 500;
const CACHE_TTL_MS = 10 * 60 * 1_000;

const cache = new Map<
  string,
  { at: number; ads: MetaAdInsight[]; daily: MetaDailySpend[] }
>();

function toNumber(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `act_` é obrigatório na URL; a env pode ou não trazer o prefixo. */
function normalizeAccountId(value: string): string {
  return value.startsWith("act_") ? value : `act_${value}`;
}

/** Uma linha crua da Graph: um anúncio **num dia**, por causa do `time_increment`. */
export type DailyAdRow = MetaAdInsight & { date: string | null };

function parseRow(raw: unknown): DailyAdRow | null {
  const row = insightRowSchema.safeParse(raw);
  if (!row.success) return null;
  const started = row.data.actions?.find(
    (action) => action.action_type === MESSAGING_STARTED
  );
  return {
    date: row.data.date_start ?? null,
    adId: row.data.ad_id,
    adName: row.data.ad_name ?? null,
    adsetId: row.data.adset_id ?? null,
    adsetName: row.data.adset_name ?? null,
    campaignId: row.data.campaign_id ?? null,
    campaignName: row.data.campaign_name ?? null,
    spend: toNumber(row.data.spend),
    impressions: toNumber(row.data.impressions),
    clicks: toNumber(row.data.clicks),
    messagingStarted: toNumber(started?.value),
  };
}

/**
 * Dobra as linhas diárias em uma linha por anúncio, somando o período inteiro.
 *
 * ⚠️ **`ads` tem que continuar com `adId` único.** `summarizeSpend` percorre a
 * lista somando `spend` por anúncio presente na coorte; com uma linha por dia,
 * o mesmo anúncio entraria N vezes e o investimento seria multiplicado pelo
 * número de dias do recorte. O teste "soma o mesmo anúncio uma vez só" cobre o
 * outro lado dessa mesma conta.
 *
 * Nome, conjunto e campanha vêm da **última** linha do anúncio: se a peça foi
 * renomeada no meio do período, o nome recente é o que a pessoa reconhece.
 */
export function aggregateInsightRows(rows: readonly DailyAdRow[]): {
  ads: MetaAdInsight[];
  daily: MetaDailySpend[];
} {
  const byAd = new Map<string, MetaAdInsight>();
  const byDate = new Map<string, number>();

  for (const row of rows) {
    const current = byAd.get(row.adId);
    if (current) {
      current.spend += row.spend;
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      current.messagingStarted += row.messagingStarted;
      current.adName = row.adName ?? current.adName;
      current.adsetId = row.adsetId ?? current.adsetId;
      current.adsetName = row.adsetName ?? current.adsetName;
      current.campaignId = row.campaignId ?? current.campaignId;
      current.campaignName = row.campaignName ?? current.campaignName;
    } else {
      byAd.set(row.adId, {
        adId: row.adId,
        adName: row.adName,
        adsetId: row.adsetId,
        adsetName: row.adsetName,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        messagingStarted: row.messagingStarted,
      });
    }

    if (row.date) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.spend);
  }

  return {
    ads: [...byAd.values()],
    daily: [...byDate.entries()]
      .map(([date, spend]) => ({ date, spend }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Gasto por anúncio no recorte, em BRL (a moeda da conta).
 *
 * O fuso da conta é `America/Sao_Paulo`, mesmo deslocamento do
 * `America/Fortaleza` que a coorte usa e nenhum dos dois tem horário de verão —
 * por isso `from`/`to` podem ir crus, sem conversão.
 *
 * Nunca lança: devolve `{ ok: false }` com o motivo. A tela precisa continuar
 * de pé mostrando o funil mesmo sem o dinheiro.
 */
export async function getMetaAdInsights({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<MetaInsightsResult> {
  const config = getMetaRuntimeConfig();
  if (!config.accessToken || !config.adAccountId) {
    return { ok: false, reason: "nao_configurado" };
  }

  const key = `${from}|${to}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, ads: cached.ads, daily: cached.daily };
  }

  const account = normalizeAccountId(config.adAccountId);
  const first = new URL(
    `https://graph.facebook.com/${config.graphApiVersion}/${account}/insights`
  );
  first.searchParams.set("level", "ad");
  first.searchParams.set("time_range", JSON.stringify({ since: from, until: to }));
  // Uma linha por anúncio POR DIA. É a mesma requisição de antes — a quebra por
  // dia é o que alimenta o gráfico do período, e o total por anúncio sai da
  // soma aqui dentro em vez de uma segunda chamada à Meta.
  first.searchParams.set("time_increment", "1");
  first.searchParams.set("fields", FIELDS);
  first.searchParams.set("limit", String(PAGE_SIZE));

  const rows: DailyAdRow[] = [];
  let next: string | undefined = first.toString();

  for (let page = 0; page < MAX_PAGES && next; page += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(next, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
    } catch {
      return { ok: false, reason: "erro_meta" };
    }
    if (!response.ok) return { ok: false, reason: "erro_meta" };

    const json: unknown = await response.json().catch(() => null);
    const parsed = insightsPageSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: "erro_meta" };

    for (const raw of parsed.data.data) {
      const row = parseRow(raw);
      if (row) rows.push(row);
    }
    next = parsed.data.paging?.next;
  }

  const { ads, daily } = aggregateInsightRows(rows);
  cache.set(key, { at: Date.now(), ads, daily });
  return { ok: true, ads, daily };
}

/** Só para teste: o cache é de módulo e sobrevive entre casos. */
export function resetMetaInsightsCache() {
  cache.clear();
}
