import { LifeBuoyIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/data-display/empty-state";
import type { RecoveryBreakdown } from "@/features/dashboard/types";
import { getColorStyle } from "@/features/leads/schemas/colors";
import { formatNumber } from "@/lib/formatters/numbers";
import { formatPercentage, ratioPercentage } from "@/lib/formatters/percentage";
import { cn } from "@/lib/utils";

type RecoveryCardProps = {
  recovery: RecoveryBreakdown;
};

const ROWS = [
  { key: "sent", label: "Enviados", color: "blue" },
  { key: "replied", label: "Responderam", color: "amber" },
  { key: "recovered", label: "Recuperados", color: "emerald" },
] as const;

export function RecoveryCard({ recovery }: RecoveryCardProps) {
  return (
    <Card className="h-full gap-0 py-0">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">
              Recuperação de leads
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatNumber(recovery.sent)} leads em régua de retomada
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-border/70 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <LifeBuoyIcon className="size-4 text-muted-foreground" aria-hidden />
            <div className="leading-tight">
              <div className="text-sm font-semibold tabular-nums tracking-tight">
                {formatPercentage(recovery.rate)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                taxa de recuperação
              </div>
            </div>
          </div>
        </div>

        {recovery.sent <= 0 ? (
          <div className="mt-4">
            <EmptyState>Nenhum follow-up enviado no período.</EmptyState>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {ROWS.map((row) => {
              const count = recovery[row.key];
              const pct = Math.round(ratioPercentage(count, recovery.sent));

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
                      {formatNumber(count)} ({pct}%)
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
