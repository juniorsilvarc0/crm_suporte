"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/data-display/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import type { WeekdaySales } from "@/features/dashboard/types";
import { formatNumber } from "@/lib/formatters/numbers";

// Gráfico de colunas — série única (vendas por dia da semana), então uma cor só
// (--chart-1) e sem legenda (o título nomeia a série).
export function WeekdaySalesChart({ data }: { data: WeekdaySales[] }) {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card className="h-80 gap-0 py-0">
      <CardContent className="flex h-full min-h-0 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Vendas por dia da semana
          </h2>
          <div className="shrink-0 text-right">
            <p className="font-display text-base font-semibold tabular-nums">{formatNumber(total)}</p>
            <p className="text-[11px] text-muted-foreground">vendas</p>
          </div>
        </div>

        {total === 0 ? (
          <div className="mt-3 flex min-h-0 flex-1 items-center">
            <EmptyState>Nenhuma venda no período.</EmptyState>
          </div>
        ) : (
          <div
            className="mt-3 min-h-0 flex-1"
            role="img"
            aria-label="Vendas por dia da semana"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  contentStyle={{
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--card-foreground)",
                    fontSize: "0.75rem",
                  }}
                  formatter={(value) => [formatNumber(Number(value)), "Vendas"]}
                />
                <Bar
                  name="Vendas"
                  dataKey="count"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                  barSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
