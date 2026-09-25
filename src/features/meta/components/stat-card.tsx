import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// neutral é o padrão. accent marca o indicador que o operador acompanha na
// seção; critical existe só onde há severidade real — dead letter acumulada.
// Nenhum hue novo entra aqui: os três saem de --muted, --primary e --destructive.
export type StatTone = "neutral" | "accent" | "critical";

const chip: Record<StatTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-primary/10 text-primary",
  critical: "bg-destructive/10 text-destructive",
};

/**
 * Contêiner dos indicadores: UMA superfície com divisores, não N cartões
 * soltos. Cinco cartões com borda e sombra próprias empilhavam moldura sobre
 * moldura e faziam a tela parecer cheia sem dizer mais nada (UI.md §Anti-padrões,
 * "empilhar um card para cada dado pequeno").
 */
export function StatBand({
  children,
  columns = 5,
}: {
  children: ReactNode;
  columns?: 3 | 5;
}) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft",
        "grid-cols-2 divide-x divide-y divide-border/60",
        columns === 5 ? "sm:grid-cols-3 xl:grid-cols-5" : "sm:grid-cols-3"
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            chip[tone]
          )}
        >
          <Icon className="size-4" strokeWidth={1.8} aria-hidden />
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {hint ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
