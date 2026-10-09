"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

import { EmptyState } from "@/components/data-display/empty-state";
import type { DailyPoint } from "@/features/metrics/types";
import { formatNumber } from "@/lib/formatters/numbers";

// Abertos × resolvidos por dia (skill dataviz): duas séries no tempo = duas
// linhas de 2 px, um eixo só, grade horizontal discreta, legenda sempre (2
// séries), cruz que acha o dia + tooltip com as duas séries, e uma tabela para
// quem não vê o gráfico. As cores são tokens validados pelo script da skill
// nos dois temas (`--chart-opened`/`--chart-resolved`, globals.css).

const SERIES = [
  { key: "abertos", label: "Abertos", color: "var(--color-chart-opened)", swatch: "bg-chart-opened" },
  { key: "resolvidos", label: "Resolvidos", color: "var(--color-chart-resolved)", swatch: "bg-chart-resolved" },
] as const;

/** "2026-10-09" → "09/10". */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid gap-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="text-muted-foreground">{dayLabel(String(label))}</p>
      {SERIES.map((series) => {
        const entry = payload.find((item) => item.dataKey === series.key);
        return (
          <p key={series.key} className="flex items-center gap-2">
            {/* Chave de linha, não caixa: no tooltip a cor só identifica. */}
            <span aria-hidden className={`h-0.5 w-3 rounded-full ${series.swatch}`} />
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(Number(entry?.value ?? 0))}</span>
            <span className="text-muted-foreground">{series.label}</span>
          </p>
        );
      })}
    </div>
  );
}

export function OpenedResolvedChart({ data, days }: { data: DailyPoint[]; days: number }) {
  const totals = {
    abertos: data.reduce((sum, point) => sum + point.abertos, 0),
    resolvidos: data.reduce((sum, point) => sum + point.resolvidos, 0),
  };
  const empty = totals.abertos === 0 && totals.resolvidos === 0;

  return (
    <section aria-labelledby="opened-resolved-title" className="rounded-xl border border-border/60 bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="opened-resolved-title" className="text-sm font-semibold tracking-tight">
            Abertos × resolvidos por dia
          </h2>
          <p className="text-xs text-muted-foreground">Últimos {days} dias</p>
        </div>
        {/* Legenda com o total de cada série: a identidade nunca depende só da cor. */}
        <ul className="flex flex-wrap items-center gap-4 text-xs">
          {SERIES.map((series) => (
            <li key={series.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`h-0.5 w-4 rounded-full ${series.swatch}`} />
              <span className="text-muted-foreground">{series.label}</span>
              <span className="font-semibold tabular-nums">{formatNumber(totals[series.key])}</span>
            </li>
          ))}
        </ul>
      </div>

      {empty ? (
        <div className="mt-4">
          <EmptyState>Nenhum ticket aberto ou resolvido no período.</EmptyState>
        </div>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Por dia nos últimos ${days} dias: ${formatNumber(totals.abertos)} abertos e ${formatNumber(totals.resolvidos)} resolvidos. A tabela a seguir traz os números de cada dia.`}
            className="mt-4"
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  tickFormatter={dayLabel}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={ChartTooltip}
                  cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1, strokeOpacity: 0.4 }}
                />
                {SERIES.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={false}
                    // Marcador do dia em foco: 8 px, com anel de 2 px na cor do card.
                    activeDot={{ r: 4, fill: series.color, stroke: "var(--color-card)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <table className="sr-only">
            <caption>Abertos e resolvidos por dia, últimos {days} dias</caption>
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">Abertos</th>
                <th scope="col">Resolvidos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{dayLabel(point.date)}</th>
                  <td>{point.abertos}</td>
                  <td>{point.resolvidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
