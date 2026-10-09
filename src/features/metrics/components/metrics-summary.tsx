import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";

import { formatMetricDuration } from "@/features/metrics/lib/summarize";
import type { SupportMetrics } from "@/features/metrics/types";
import { formatNumber } from "@/lib/formatters/numbers";
import { formatPercentage, ratioPercentage } from "@/lib/formatters/percentage";
import { cn } from "@/lib/utils";

type Stat = { label: string; value: string; hint: string };

/**
 * Uma superfície, um número protagonista (UI.md §5.4 e §9: hierarquia por
 * tamanho, não N cartões iguais). À esquerda o que está em aberto AGORA, que
 * não segue o período; à direita os números da janela. Todo número diz a
 * janela dele e traz o lastro (§5.8).
 */
export function MetricsSummary({ metrics, days }: { metrics: SupportMetrics; days: number }) {
  const stats: Stat[] = [
    { label: "Abertos", value: formatNumber(metrics.opened), hint: "tickets novos" },
    { label: "Resolvidos", value: formatNumber(metrics.resolved), hint: "pela data da resolução" },
    {
      label: "1ª resposta",
      value: formatMetricDuration(metrics.firstResponse.medianMs),
      hint:
        metrics.firstResponse.sample > 0
          ? `mediana · ${formatNumber(metrics.firstResponse.sample)} com resposta do analista`
          : "nenhum ticket respondido",
    },
    {
      label: "Resolução",
      value: formatMetricDuration(metrics.resolution.medianMs),
      hint:
        metrics.resolution.sample > 0
          ? `mediana · ${formatNumber(metrics.resolution.sample)} resolvidos · tempo corrido`
          : "nenhum ticket resolvido",
    },
    { label: "Reaberturas", value: formatNumber(metrics.reopened), hint: "voltaram de resolvido" },
    {
      label: "Abertos pela IA",
      value: metrics.opened > 0 ? formatPercentage(ratioPercentage(metrics.openedByAi, metrics.opened)) : "—",
      hint:
        metrics.opened > 0
          ? `${formatNumber(metrics.openedByAi)} de ${formatNumber(metrics.opened)}`
          : "nenhum ticket aberto",
    },
  ];
  const breached = metrics.breachedNow > 0;

  return (
    <section
      aria-label="Resumo"
      className="grid overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
    >
      <div className="grid content-start gap-1 border-b border-border/60 p-5 lg:border-b-0 lg:border-r">
        <h2 className="text-sm font-medium text-muted-foreground">Em aberto agora</h2>
        {/* Número protagonista: algarismos proporcionais em tamanho grande. */}
        <p className="font-display text-5xl font-semibold tracking-tight">{formatNumber(metrics.openNow)}</p>
        <p
          className={cn(
            "mt-1 inline-flex items-center gap-1.5 text-sm",
            breached ? "font-medium text-destructive" : "text-muted-foreground"
          )}
        >
          {breached ? (
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          ) : (
            <CircleCheckIcon className="size-4 shrink-0" aria-hidden />
          )}
          {breached
            ? `${formatNumber(metrics.breachedNow)} com SLA estourado`
            : "nenhum com SLA estourado"}
        </p>
        <p className="text-xs text-muted-foreground">Não encerrados nem resolvidos, independente do período.</p>
      </div>

      <div className="grid content-start gap-4 p-5">
        <h2 className="text-sm font-medium text-muted-foreground">Nos últimos {days} dias</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="grid min-w-0 content-start gap-0.5">
              <dt className="truncate text-xs font-medium text-muted-foreground">{stat.label}</dt>
              <dd className="truncate font-display text-2xl font-semibold tracking-tight">{stat.value}</dd>
              <dd className="text-[11px] leading-snug text-muted-foreground">{stat.hint}</dd>
            </div>
          ))}
        </dl>
        {metrics.partial ? (
          <p className="text-xs text-muted-foreground">
            Mais tickets que o limite de leitura: as contagens são exatas, mas medianas, IA e gráfico saem de uma
            amostra.
          </p>
        ) : null}
      </div>
    </section>
  );
}
