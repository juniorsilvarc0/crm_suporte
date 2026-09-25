"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/data-display/empty-state";
import type { PeriodPoint } from "@/features/meta/costs";
import { formatMoney, formatMoneyExact } from "@/lib/formatters/money";

function formatDay(value: string) {
  const [, month, day] = value.split("-");
  return month && day ? `${day}/${month}` : value;
}

function formatFullDay(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/**
 * Investimento e contatos lado a lado, dia a dia.
 *
 * As duas séries no mesmo eixo horizontal existem para responder a única
 * pergunta que a soma do período não responde: **o dia caro foi o dia cheio?**
 * Barra é dinheiro, linha é gente — formas diferentes porque as escalas são
 * diferentes, e dois eixos Y porque R$ 120 e 6 contatos não cabem na mesma
 * régua.
 *
 * Convenções herdadas de `features/dashboard/components/daily-chart.tsx`: eixo
 * sem moldura, tick de 11 px no token `muted-foreground`, tooltip com as cores
 * de popover, e o wrapper `role="img"` com um resumo em texto — o gráfico nunca
 * é a única forma de ler o dado.
 */
export function PeriodChart({
  points,
  hasSpend,
}: {
  points: PeriodPoint[];
  /** `false` quando a Meta não respondeu: sem dinheiro, o gráfico não se paga. */
  hasSpend: boolean;
}) {
  const totalSpend = points.reduce((sum, point) => sum + point.spend, 0);
  const totalContacts = points.reduce((sum, point) => sum + point.contacts, 0);
  const empty = points.length === 0 || (totalSpend === 0 && totalContacts === 0);

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
      <header className="flex items-end justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">Dia a dia</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Quanto entrou de gente e quanto saiu de verba em cada dia
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-right">
          <Legend color="var(--chart-1)" shape="bar" label="Investimento" />
          <Legend color="var(--chart-2)" shape="line" label="Contatos" />
        </div>
      </header>

      <div className="px-2 pb-4 sm:px-3 sm:pb-5">
        {empty ? (
          <EmptyState>Sem investimento nem contato neste período.</EmptyState>
        ) : (
          <div
            role="img"
            aria-label={`${formatMoney(totalSpend)} investidos e ${totalContacts} contatos ao longo de ${points.length} dias`}
          >
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="spend"
                  tickFormatter={(value: number) => formatMoney(value)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  hide={!hasSpend}
                />
                <YAxis
                  yAxisId="contacts"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
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
                  labelFormatter={(label) => formatFullDay(String(label))}
                  formatter={(value, name) =>
                    name === "Investimento"
                      ? [formatMoneyExact(Number(value)), name]
                      : [String(value), name]
                  }
                />
                {hasSpend ? (
                  <Bar
                    yAxisId="spend"
                    dataKey="spend"
                    name="Investimento"
                    fill="var(--chart-1)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                ) : null}
                <Line
                  yAxisId="contacts"
                  dataKey="contacts"
                  name="Contatos"
                  type="monotone"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}

function Legend({
  color,
  shape,
  label,
}: {
  color: string;
  shape: "bar" | "line";
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      <span
        aria-hidden
        className={shape === "bar" ? "h-2.5 w-2 rounded-[2px]" : "h-0.5 w-3 rounded-full"}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
