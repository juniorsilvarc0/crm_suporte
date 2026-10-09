"use client";

import Link from "next/link";
import { useState } from "react";

import { AgendaLinkProgress } from "@/features/appointments/components/agenda-nav-progress";
import {
  AGENDA_VIEWS,
  agendaViewHref,
  agendaViewLabel,
  type AgendaPeriod,
  type AgendaView,
} from "@/features/appointments/lib/agenda-view";
import { cn } from "@/lib/utils";

/**
 * Mês · Semana · Dia · Lista. Cada aba é um link (a visão é a URL), no mesmo
 * desenho do "Lista | Quadro" dos tickets.
 *
 * Seleção otimista (UI.md §5.21): a aba acende no toque, não quando o servidor
 * responde — só os search params mudam, o `loading.tsx` não aparece, e sem
 * isto o toque parecia ignorado. `aria-current` segue a visão REAL: pintar a
 * aba é promessa visual; dizer ao leitor de tela que a página já é outra seria
 * mentira.
 */
export function AgendaViewTabs({ period }: { period: AgendaPeriod }) {
  const [clicked, setClicked] = useState<AgendaView | null>(null);
  const [lastView, setLastView] = useState(period.view);
  if (lastView !== period.view) {
    // A página nova chegou (ou voltou pelo histórico): o palpite sai de cena.
    setLastView(period.view);
    setClicked(null);
  }
  const activeView = clicked ?? period.view;

  return (
    <div
      // Sem `relative` de propósito: a barra de progresso de cada aba se
      // resolve contra a faixa inteira da toolbar, não contra o segmentado.
      role="group"
      aria-label="Modo de visualização"
      className="grid min-w-0 flex-1 grid-cols-4 gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5 sm:inline-flex sm:flex-none sm:items-center"
    >
      {AGENDA_VIEWS.map((view) => (
        <Link
          key={view}
          href={agendaViewHref(view, period)}
          aria-current={period.view === view ? "page" : undefined}
          data-active={activeView === view ? "true" : undefined}
          onClick={() => setClicked(view)}
          className={cn(
            "flex h-10 min-w-0 items-center justify-center rounded-md px-1 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8 sm:px-3",
            activeView === view ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="truncate">{agendaViewLabel[view]}</span>
          <AgendaLinkProgress />
        </Link>
      ))}
    </div>
  );
}
