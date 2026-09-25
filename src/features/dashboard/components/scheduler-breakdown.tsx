import { CalendarCheckIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/data-display/empty-state";
import type { SchedulerRow } from "@/features/dashboard/types";
import { getColorStyle } from "@/features/leads/schemas/colors";
import { formatNumber } from "@/lib/formatters/numbers";
import { ratioPercentage } from "@/lib/formatters/percentage";
import { cn } from "@/lib/utils";

type SchedulerBreakdownProps = {
  rows: SchedulerRow[];
};

export function SchedulerBreakdown({ rows }: SchedulerBreakdownProps) {
  const totalAgendados = rows.reduce((acc, r) => acc + r.total, 0);
  const totalCompareceu = rows.reduce((acc, r) => acc + r.compareceu, 0);
  const maxTotal = rows.reduce((acc, r) => Math.max(acc, r.total), 0);

  return (
    <Card className="h-full gap-0 py-0">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Quem agendou</h2>
            <p className="text-sm text-muted-foreground">
              {formatNumber(totalAgendados)} agendamentos no período — por responsável
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-border/70 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <CalendarCheckIcon className="size-4 text-muted-foreground" aria-hidden />
            <div className="leading-tight">
              <div className="text-sm font-semibold tabular-nums tracking-tight">
                {formatNumber(totalCompareceu)}
              </div>
              <div className="text-[11px] text-muted-foreground">compareceram</div>
            </div>
          </div>
        </div>

        {totalAgendados <= 0 ? (
          <div className="mt-4">
            <EmptyState>Nenhum agendamento no período.</EmptyState>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {rows.map((row) => {
              const pct = maxTotal
                ? Math.round(ratioPercentage(row.total, maxTotal))
                : 0;
              const key = row.userId ?? "__ia__";

              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          getColorStyle(row.color).dot,
                        )}
                      />
                      <span className="text-sm font-medium">{row.name}</span>
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatNumber(row.total)} agendados · {formatNumber(row.compareceu)}{" "}
                      compareceram
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        getColorStyle(row.color).bar,
                      )}
                      style={{ width: `${pct}%` }}
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
