"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/data-display/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { OverlayScrollArea } from "@/components/ui/overlay-scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SourceRow } from "@/features/dashboard/types";
import { getColorStyle } from "@/features/leads/schemas/colors";
import { formatNumber } from "@/lib/formatters/numbers";
import { cn } from "@/lib/utils";

type Metric = "leads" | "vendas";

const METRICS: { value: Metric; label: string }[] = [
  { value: "leads", label: "Leads" },
  { value: "vendas", label: "Vendas" },
];

function formatValue(metric: Metric, row: SourceRow): string {
  if (metric === "vendas") return formatNumber(row.vendas);
  return formatNumber(row.leads);
}

export function BySourceCard({ rows }: { rows: SourceRow[] }) {
  const [metric, setMetric] = useState<Metric>("leads");

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b[metric] - a[metric]),
    [rows, metric],
  );

  const maxValue = useMemo(
    () => sorted.reduce((max, row) => Math.max(max, row[metric]), 0),
    [sorted, metric],
  );

  return (
    <Card className="h-80 gap-0 py-0">
      <CardContent className="flex h-full min-h-0 flex-col p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Por Origem</h2>
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(value as Metric)}
          >
            <TabsList className="h-11 sm:h-8">
              {METRICS.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {sorted.length === 0 ? (
          <div className="mt-3 flex min-h-0 flex-1 items-center">
            <EmptyState>Sem dados de origem.</EmptyState>
          </div>
        ) : (
          <OverlayScrollArea
            className="-mr-2 mt-3 min-h-0 flex-1"
            viewportClassName="pr-3"
            role="region"
            aria-label="Distribuição por origem"
          >
            <ul className="space-y-2.5 pb-1">
              {sorted.map((row) => {
                const value = row[metric];
                const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;

                return (
                  <li key={row.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm text-muted-foreground">
                        {row.label}
                      </span>
                      <span className="tabular-nums text-sm font-medium">
                        {formatValue(metric, row)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          getColorStyle(row.color).bar,
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </OverlayScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
