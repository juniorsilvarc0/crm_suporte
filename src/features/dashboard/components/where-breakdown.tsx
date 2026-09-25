import { ClockIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/data-display/empty-state";
import type { WhereBreakdown as WhereBreakdownData } from "@/features/dashboard/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatNumber } from "@/lib/formatters/numbers";
import { formatPercentage, ratioPercentage } from "@/lib/formatters/percentage";
import { cn } from "@/lib/utils";

type WhereBreakdownProps = {
  where: WhereBreakdownData;
};

const ROWS = [
  { key: "converted", label: "Convertidas", color: "emerald" },
  { key: "inStage", label: "Em etapa", color: "blue" },
  { key: "noContact", label: "Sem contato", color: "amber" },
  { key: "lost", label: "Perdidas", color: "rose" },
] as const;

export function WhereBreakdown({ where }: WhereBreakdownProps) {
  return (
    <Card className="h-full gap-0 py-0">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">
              Leads capturados no período
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatNumber(where.total)} leads — onde estão hoje
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-border/70 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <ClockIcon className="size-4 text-muted-foreground" aria-hidden />
            <div className="leading-tight">
              <div className="text-sm font-semibold tabular-nums tracking-tight">
                {where.avgConversionDays === null
                  ? "—"
                  : `${Math.round(where.avgConversionDays)} dias`}
              </div>
              <div className="text-[11px] text-muted-foreground">
                tempo médio de conversão
              </div>
            </div>
          </div>
        </div>

        {where.total <= 0 ? (
          <div className="mt-4">
            <EmptyState>Nenhum lead capturado no período.</EmptyState>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {ROWS.map((row) => {
              const count = where[row.key];
              const ratio = ratioPercentage(count, where.total);
              // Piso de 1% na barra: uma fatia real com largura zero lê como
              // "nenhum", e o número ao lado já diz a verdade.
              const width = count > 0 ? Math.max(ratio, 1) : 0;

              return (
                <div key={row.key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          getColorStyle(row.color).dot,
                        )}
                      />
                      <span className="text-sm font-medium">{row.label}</span>
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatNumber(count)} ({formatPercentage(ratio)})
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        getColorStyle(row.color).bar,
                      )}
                      style={{ width: `${width}%` }}
                    />
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
