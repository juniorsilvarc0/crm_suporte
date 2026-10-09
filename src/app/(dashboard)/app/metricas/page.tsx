import Link from "next/link";

import { EmptyState } from "@/components/data-display/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { MetricsPeriodSwitch } from "@/features/metrics/components/metrics-period-switch";
import { MetricsSummary } from "@/features/metrics/components/metrics-summary";
import { OpenedResolvedChart } from "@/features/metrics/components/opened-resolved-chart";
import { metricPeriodHref, metricRange, parseMetricPeriod } from "@/features/metrics/lib/period";
import { getSupportMetrics } from "@/features/metrics/queries/get-support-metrics";
import { requireAdminPage } from "@/lib/auth/require-dashboard-session";
import { getTodayAppDateKey } from "@/lib/formatters/date";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Métricas",
};

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Admin confirmado no BANCO antes da leitura: member vai para /app, e quem
  // foi desativado (com cookie ainda válido) sai pelo logout.
  await requireAdminPage();

  const days = parseMetricPeriod(await searchParams);
  const metrics = await getSupportMetrics(metricRange(days, getTodayAppDateKey()));

  return (
    <main className="mx-auto w-full max-w-screen-xl space-y-4 p-4 sm:p-6 lg:p-8">
      {/* O período fica numa linha acima de tudo o que ele recorta. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Métricas</h1>
          <p className="text-sm text-muted-foreground">Atendimento de suporte: o que está aberto e como a fila andou.</p>
        </div>
        <MetricsPeriodSwitch days={days} />
      </div>

      {metrics.failed ? (
        <EmptyState>
          <span className="flex flex-col items-center gap-3">
            <span>Não foi possível carregar as métricas.</span>
            <Link href={metricPeriodHref(days)} className={buttonVariants({ variant: "outline", className: "h-11 sm:h-9" })}>
              Tentar de novo
            </Link>
          </span>
        </EmptyState>
      ) : (
        <>
          <MetricsSummary metrics={metrics} days={days} />
          <OpenedResolvedChart data={metrics.daily} days={days} />
        </>
      )}
    </main>
  );
}
