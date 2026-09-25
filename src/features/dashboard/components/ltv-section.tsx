import { DollarSignIcon, RefreshCwIcon, TrendingUpIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/data-display/empty-state";
import { getColorStyle } from "@/features/tags/schemas/colors";
import type { LtvSummary } from "@/features/dashboard/types";
import { formatMoney } from "@/lib/formatters/money";
import { formatNumber } from "@/lib/formatters/numbers";
import { formatPercentage, ratioPercentage } from "@/lib/formatters/percentage";
import { cn } from "@/lib/utils";

function BarRow({
  label,
  color,
  pct,
  value,
}: {
  label: string;
  color: string;
  pct: number;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", getColorStyle(color).bar)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function LtvSection({ ltv }: { ltv: LtvSummary }) {
  const lifecycleRows = [
    { label: "Primeira compra", color: "indigo", count: ltv.lifecycle.first },
    { label: "Fiel", color: "emerald", count: ltv.lifecycle.loyal },
    { label: "Campeão", color: "amber", count: ltv.lifecycle.champion },
  ];

  return (
    <Card className="rounded-xl border-border/70 shadow-none">
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold tracking-tight">LTV &amp; Recompra</h2>

        {ltv.clients === 0 ? (
          <div className="mt-4">
            <EmptyState>Ainda não há clientes com compra registrada.</EmptyState>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatPercentage(ltv.repurchaseRate)}
                  </span>
                  <RefreshCwIcon className="size-4 text-primary" aria-hidden />
                </div>
                <p className="mt-1 text-sm font-medium">Taxa de recompra</p>
                <p className="text-xs text-muted-foreground">do total de vendas no período</p>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-semibold tabular-nums text-emerald-600">
                    {formatMoney(ltv.repurchaseRevenue)}
                  </span>
                  <DollarSignIcon className="size-4 text-emerald-600" aria-hidden />
                </div>
                <p className="mt-1 text-sm font-medium">Receita de recompra</p>
                <p className="text-xs text-muted-foreground">no período selecionado</p>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatMoney(ltv.avgLtv)}
                  </span>
                  <TrendingUpIcon className="size-4 text-amber-600" aria-hidden />
                </div>
                <p className="mt-1 text-sm font-medium">LTV médio por cliente</p>
                <p className="text-xs text-muted-foreground">gasto total acumulado</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Receita no período
                </p>
                <div className="mt-3 flex flex-col gap-4">
                  <BarRow
                    label="Primeira compra"
                    color="blue"
                    pct={ltv.firstPurchaseShare}
                    value={
                      <>
                        {formatMoney(ltv.firstPurchaseRevenue)}{" "}
                        <span className="text-muted-foreground">
                          ({formatPercentage(ltv.firstPurchaseShare)})
                        </span>
                      </>
                    }
                  />
                  <BarRow
                    label="Recompra"
                    color="emerald"
                    pct={ltv.repurchaseShare}
                    value={
                      <>
                        {formatMoney(ltv.repurchaseRevenue)}{" "}
                        <span className="text-muted-foreground">
                          ({formatPercentage(ltv.repurchaseShare)})
                        </span>
                      </>
                    }
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Ciclo de vida — {formatNumber(ltv.lifecycle.total)} clientes com compra
                  </p>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Tempo real
                  </span>
                </div>
                <div className="mt-3 flex flex-col gap-4">
                  {lifecycleRows.map((row) => {
                    const pct = ratioPercentage(row.count, ltv.lifecycle.total);
                    return (
                      <BarRow
                        key={row.label}
                        label={row.label}
                        color={row.color}
                        pct={pct}
                        value={
                          <>
                            {formatNumber(row.count)}{" "}
                            <span className="text-muted-foreground">
                              ({formatPercentage(pct)})
                            </span>
                          </>
                        }
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
