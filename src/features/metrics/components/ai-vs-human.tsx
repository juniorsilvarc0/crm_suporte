import { formatMetricDuration } from "@/features/metrics/lib/summarize";
import type { AiVsHuman as AiVsHumanMetrics } from "@/features/metrics/types";
import { formatNumber } from "@/lib/formatters/numbers";

/**
 * IA × analista na janela, numa banda (UI.md §9: não N cartões): quem abriu, a
 * 1ª resposta da IA (a do analista já está no resumo) e o que foi resolvido
 * sem o analista responder. Cada número traz o lastro.
 */
export function AiVsHuman({ metrics, resolved, days }: { metrics: AiVsHumanMetrics; resolved: number; days: number }) {
  const { openedBy, firstAiResponse, resolvedWithoutHuman } = metrics;

  return (
    <section aria-labelledby="ai-vs-human-title" className="rounded-xl border border-border/60 bg-card p-5 shadow-soft">
      <h2 id="ai-vs-human-title" className="text-sm font-semibold tracking-tight">
        IA × analista
      </h2>
      <p className="text-xs text-muted-foreground">Últimos {days} dias</p>

      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <div className="grid min-w-0 content-start gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">Quem abriu</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span>
              <span className="font-display text-2xl font-semibold tracking-tight">{formatNumber(openedBy.ai)}</span> IA
            </span>
            <span>
              <span className="font-display text-2xl font-semibold tracking-tight">{formatNumber(openedBy.agent)}</span>{" "}
              analista
            </span>
            <span>
              <span className="font-display text-2xl font-semibold tracking-tight">{formatNumber(openedBy.api)}</span>{" "}
              integração
            </span>
          </dd>
        </div>
        <div className="grid min-w-0 content-start gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">1ª resposta da IA</dt>
          <dd className="font-display text-2xl font-semibold tracking-tight">
            {formatMetricDuration(firstAiResponse.medianMs)}
          </dd>
          <dd className="text-[11px] leading-snug text-muted-foreground">
            {firstAiResponse.sample > 0
              ? `mediana · ${formatNumber(firstAiResponse.sample)} com resposta da IA`
              : "a IA não respondeu nenhum ticket aberto no período"}
          </dd>
        </div>
        <div className="grid min-w-0 content-start gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">Resolvidos sem o analista</dt>
          <dd className="font-display text-2xl font-semibold tracking-tight">{formatNumber(resolvedWithoutHuman)}</dd>
          <dd className="text-[11px] leading-snug text-muted-foreground">
            {resolved > 0
              ? `de ${formatNumber(resolved)} resolvidos, sem nenhuma resposta do analista`
              : "nenhum ticket resolvido"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
