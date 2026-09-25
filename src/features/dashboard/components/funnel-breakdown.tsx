import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/data-display/empty-state";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatNumber } from "@/lib/formatters/numbers";
import { cn } from "@/lib/utils";
import type { FunnelBreakdown } from "@/features/dashboard/types";

type FunnelBreakdownProps = {
  funnel: FunnelBreakdown;
};

const STAGES = [
  { key: "novas", label: "Novas", color: "blue" },
  { key: "emEtapa", label: "Em etapa", color: "amber" },
  { key: "vendidas", label: "Vendidas", color: "emerald" },
  { key: "perdidas", label: "Perdidas", color: "rose" },
] as const;

export function FunnelBreakdown({ funnel }: FunnelBreakdownProps) {
  const rows = STAGES.map((stage) => ({
    ...stage,
    value: funnel[stage.key],
  }));

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(...rows.map((row) => row.value), 0);

  return (
    <Card className="rounded-xl border-border/70 shadow-none">
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold tracking-tight">Funil de leads</h2>

        {total === 0 ? (
          <div className="mt-4">
            <EmptyState>Nenhum lead no período.</EmptyState>
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {rows.map((row) => {
              const pct = max > 0 ? (row.value / max) * 100 : 0;
              return (
                <div
                  key={row.key}
                  className="relative h-9 w-full overflow-hidden rounded-lg bg-muted"
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-lg",
                      getColorStyle(row.color).bar,
                    )}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex h-full items-center justify-between px-3 text-sm font-medium">
                    <span>{row.label}</span>
                    <span className="tabular-nums font-semibold">
                      {formatNumber(row.value)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
