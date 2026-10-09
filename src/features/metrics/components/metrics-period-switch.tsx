import Link from "next/link";

import { METRIC_PERIODS, metricPeriodHref, type MetricPeriod } from "@/features/metrics/lib/period";
import { cn } from "@/lib/utils";

/**
 * 7 · 30 · 90 dias. Links num controle segmentado, no desenho do "Lista |
 * Quadro" dos tickets: o período é a URL, e vale para a tela inteira (a banda
 * e o gráfico usam a mesma janela). Server-renderável: são links, não estado.
 */
export function MetricsPeriodSwitch({ days }: { days: MetricPeriod }) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5"
    >
      {METRIC_PERIODS.map((option) => (
        <Link
          key={option}
          href={metricPeriodHref(option)}
          aria-current={option === days ? "page" : undefined}
          className={cn(
            "inline-flex h-10 items-center rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8",
            option === days ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option} dias
        </Link>
      ))}
    </div>
  );
}
