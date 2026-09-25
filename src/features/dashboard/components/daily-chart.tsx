"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/data-display/empty-state";
import { Card } from "@/components/ui/card";
import type { DailyPoint } from "@/features/dashboard/types";

function formatDay(value: string): string {
  const [, month, day] = value.split("-");
  return month && day ? `${day.slice(0, 2)}/${month}` : value;
}

export function DailyChart({ data }: { data: DailyPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.leads, 0);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Entradas de leads</h2>
            <p className="text-xs text-muted-foreground">Evolução no período selecionado</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-display text-lg font-semibold tabular-nums">{total}</div>
            <div className="text-[11px] text-muted-foreground">no período</div>
          </div>
        </div>

        {data.length === 0 || total === 0 ? (
          <EmptyState>Sem leads no período.</EmptyState>
        ) : (
          <div role="img" aria-label={`${total} entradas de leads distribuídas por dia`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={{
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                    fontSize: "0.75rem",
                  }}
                  labelFormatter={(label) => formatDay(String(label))}
                  formatter={(value) => [String(value), "Leads"]}
                />
                <Bar dataKey="leads" name="Leads" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}
