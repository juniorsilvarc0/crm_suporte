import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ByStateCard } from "@/features/dashboard/components/by-state-card";
import { BySourceCard } from "@/features/dashboard/components/by-source-card";
import { DailyChart } from "@/features/dashboard/components/daily-chart";
import { KpiBand } from "@/features/dashboard/components/kpi-band";
import { PeriodLinks } from "@/features/dashboard/components/period-links";
import { RecoveryCard } from "@/features/dashboard/components/recovery-card";
import { SchedulerBreakdown } from "@/features/dashboard/components/scheduler-breakdown";
import { WeekdaySalesChart } from "@/features/dashboard/components/weekday-sales-chart";
import { WhereBreakdown } from "@/features/dashboard/components/where-breakdown";
import { getPeriodFromSearchParams } from "@/features/dashboard/lib/period";
import { getDashboardData } from "@/features/dashboard/queries/get-dashboard-data";
import { getProcedures } from "@/features/financeiro/queries/get-procedures";
import { LeadsTable } from "@/features/leads/components/leads-table";

export const dynamic = "force-dynamic";

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period = getPeriodFromSearchParams(params);
  // O catálogo desce junto porque a tabela de leads recentes também registra
  // venda pelo menu da linha — sem ele o combobox abriria vazio aqui.
  const [data, procedures] = await Promise.all([
    getDashboardData(period),
    getProcedures(),
  ]);

  return (
    <>
      <PageHeader title="Métricas" />
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-end">
          <PeriodLinks activePeriod={period} />
        </div>
        <KpiBand
          kpis={data.kpis}
          awaiting={data.pipeline.awaiting}
          inStage={data.pipeline.inStage}
          converted={data.where.converted}
          total={data.where.total}
          conversionStages={data.conversionStages}
        />

        <section className="grid items-stretch gap-4 xl:grid-cols-[1.5fr_1fr]">
          <DailyChart data={data.daily} />
          <WhereBreakdown where={data.where} />
        </section>

        <section className="grid items-start gap-4 lg:grid-cols-3">
          <WeekdaySalesChart data={data.salesByWeekday} />
          <BySourceCard rows={data.bySource} />
          <ByStateCard rows={data.byState} />
        </section>

        <section className="grid items-stretch gap-4 lg:grid-cols-2">
          <RecoveryCard recovery={data.recovery} />
          <SchedulerBreakdown rows={data.schedulers} />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Leads recentes</h2>
              <p className="text-xs text-muted-foreground">Últimas 6 entradas</p>
            </div>
            <Link
              href="/app/leads"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Ver todos
              <ArrowRightIcon className="size-4" strokeWidth={2} />
            </Link>
          </div>
          <LeadsTable leads={data.recentLeads} procedures={procedures} />
        </section>
      </main>
    </>
  );
}
