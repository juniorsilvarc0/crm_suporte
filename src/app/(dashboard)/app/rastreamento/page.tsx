import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CampaignReportTable } from "@/features/meta/components/campaign-report-table";
import { CapiHealthPanel } from "@/features/meta/components/capi-health-panel";
import { ConversionFunnel } from "@/features/meta/components/conversion-funnel";
import { CostTable } from "@/features/meta/components/cost-table";
import { PeriodChart } from "@/features/meta/components/period-chart";
import { PeriodSummary } from "@/features/meta/components/period-summary";
import { TrackingFilters } from "@/features/meta/components/tracking-filters";
import { TrackingTabs } from "@/features/meta/components/tracking-tabs";
import { parseTrackingTab } from "@/features/meta/tracking-tabs";
import { requireTrackingPage } from "@/lib/auth/require-dashboard-session";
import { getMetaOperationalHealth } from "@/features/meta/health";
import { buildPeriodSeries } from "@/features/meta/costs";
import { buildConversionFunnel, costPer, summarizeSpend } from "@/features/meta/funnel";
import { getMetaAdInsights, type MetaInsightsFailure } from "@/features/meta/insights";
import { getMetaTrackingReport, getRecentMetaDeadLetters } from "@/features/meta/report";

export const dynamic = "force-dynamic";

// 7 dias é o padrão porque é o intervalo em que ainda dá para agir: um anúncio
// caro descoberto 30 dias depois já queimou a verba do mês. Os atalhos de 30 e
// 90 continuam a um toque, na faixa de filtros.
const DEFAULT_PERIOD_DAYS = 7;

function dateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function dateParam(value: string | string[] | undefined) {
  const candidate = param(value);
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
}

export default async function MetaTrackingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTrackingPage();
  const params = (await searchParams) ?? {};
  const today = new Date();
  const start = new Date(today.getTime() - (DEFAULT_PERIOD_DAYS - 1) * 86_400_000);
  const defaultFrom = dateInput(start);
  const defaultTo = dateInput(today);
  const requestedFrom = dateParam(params.from) ?? defaultFrom;
  const requestedTo = dateParam(params.to) ?? defaultTo;
  const filters = {
    from: requestedFrom <= requestedTo ? requestedFrom : defaultFrom,
    to: requestedFrom <= requestedTo ? requestedTo : defaultTo,
    campaignId: param(params.campaignId),
    adsetId: param(params.adsetId),
    adId: param(params.adId),
  };
  const initialTab = parseTrackingTab(param(params.aba));

  const [reportResult, healthResult, deadLettersResult, insightsResult] =
    await Promise.allSettled([
      getMetaTrackingReport(filters),
      getMetaOperationalHealth(),
      getRecentMetaDeadLetters(),
      getMetaAdInsights({ from: filters.from, to: filters.to }),
    ]);
  // O investimento não entra neste alerta: ele tem mensagem própria no resumo, e
  // a Meta fora do ar não é o mesmo problema que o banco fora do ar.
  const loadFailed = [reportResult, healthResult, deadLettersResult].some(
    (result) => result.status === "rejected"
  );
  const report =
    reportResult.status === "fulfilled"
      ? reportResult.value
      : {
          filters,
          totals: {
            contacts: 0,
            scheduled: 0,
            attended: 0,
            patients: 0,
            covered: 0,
            coveragePercent: 0,
          },
          campaigns: [],
          cohort: [],
          funnelStages: [],
          lost: 0,
          options: { campaigns: [], adsets: [], ads: [] },
        };
  const health =
    healthResult.status === "fulfilled"
      ? healthResult.value
      : {
          capiState: "disabled" as const,
          backlog: 0,
          sent24h: 0,
          discarded24h: 0,
          deadLetters24h: 0,
          oldestPendingAt: null,
          lastDrainAt: null,
          lastDeliveryAt: null,
        };
  const deadLetters =
    deadLettersResult.status === "fulfilled" ? deadLettersResult.value : [];
  const exportQuery = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );

  // Leads por anúncio do primeiro toque: é o anúncio que tem o gasto.
  const leadsByAd = new Map<string | null, number>();
  for (const lead of report.cohort) {
    leadsByAd.set(lead.adId, (leadsByAd.get(lead.adId) ?? 0) + 1);
  }
  const insights =
    insightsResult.status === "fulfilled"
      ? insightsResult.value
      : ({ ok: false, reason: "erro_meta" } as const);
  const insightsFailure: MetaInsightsFailure | null = insights.ok ? null : insights.reason;
  const spend = insights.ok
    ? summarizeSpend(
        [...leadsByAd].map(([adId, leads]) => ({ adId, leads })),
        insights.ads
      )
    : null;
  const funnel = buildConversionFunnel({
    stages: report.funnelStages,
    furthestPositions: report.cohort.map((lead) => lead.furthestPosition),
    lost: report.lost,
  });
  const costPerContact = spend ? costPer(spend.attributedSpend, funnel.contacts) : null;
  const costPerPatient = spend
    ? costPer(spend.attributedSpend, report.totals.patients)
    : null;
  const series = buildPeriodSeries({
    from: filters.from,
    to: filters.to,
    daily: insights.ok ? insights.daily : [],
    cohort: report.cohort,
  });
  const capiCritical = health.deadLetters24h > 0 || deadLetters.length > 0;

  return (
    <>
      <PageHeader title="Rastreamento Meta" />

      <main className="flex min-w-0 flex-col gap-4 p-4 sm:p-6 lg:p-8">
        {loadFailed ? (
          <Alert variant="destructive">
            <AlertTitle>Dados de rastreamento indisponíveis</AlertTitle>
            <AlertDescription>
              A tela permaneceu operacional, mas não foi possível consultar todas as
              tabelas Meta. Verifique a migration e o Supabase.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* O filtro fica ACIMA das abas porque vale para as quatro. Repetido
            dentro de cada uma, a mesma escolha teria quatro donos. */}
        <TrackingFilters filters={filters} options={report.options} />

        <TrackingTabs
          initialTab={initialTab}
          alerts={capiCritical ? { entrega: "há conversões falhando" } : undefined}
          visao={
            <div className="flex flex-col gap-4">
              <PeriodSummary
                spend={spend}
                contacts={report.totals.contacts}
                patients={report.totals.patients}
                costPerContact={costPerContact}
                costPerPatient={costPerPatient}
                insightsFailure={insightsFailure}
              />
              <PeriodChart points={series} hasSpend={insights.ok} />
              <ConversionFunnel
                funnel={funnel}
                spend={spend}
                insightsFailure={insightsFailure}
              />
              <p className="px-1 text-[11px] leading-4 text-muted-foreground">
                O período conta pela data do{" "}
                <strong className="font-medium">primeiro contato</strong> de cada
                pessoa vinda de anúncio — quem chegou agora ainda vai avançar depois,
                então as etapas do fim tendem a crescer com o tempo. Quem chegou por
                outro caminho não aparece aqui.
              </p>
            </div>
          }
          custos={
            <CostTable
              cohort={report.cohort}
              insights={insights.ok ? insights.ads : []}
              hasSpend={insights.ok}
            />
          }
          campanhas={
            <CampaignReportTable
              rows={report.campaigns}
              exportHref={`/api/meta/tracking/export?${exportQuery}`}
            />
          }
          entrega={
            <CapiHealthPanel
              health={health}
              deadLetters={deadLetters}
              coverage={{
                covered: report.totals.covered,
                contacts: report.totals.contacts,
                percent: report.totals.coveragePercent,
              }}
            />
          }
        />
      </main>
    </>
  );
}
