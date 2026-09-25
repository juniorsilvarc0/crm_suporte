"use client";

import Link from "next/link";
import { useState } from "react";

import { AgendaLinkProgress } from "@/features/appointments/components/agenda-nav-progress";
import {
  buildAgendaHref,
  type AgendaView,
  type AppointmentFilters,
} from "@/features/appointments/components/agenda-utils";
import { cn } from "@/lib/utils";

const viewOptions: Array<{ value: AgendaView; label: string }> = [
  { value: "month", label: "Mês" },
  { value: "semana", label: "Semana" },
  { value: "dia", label: "Dia" },
  { value: "list", label: "Lista" },
];

export function AgendaViewTabs({
  view,
  dateKey,
  monthKey,
  filters,
}: {
  view: AgendaView;
  dateKey: string;
  /** Mês a manter ao voltar de dia/semana para mês/lista. */
  monthKey: string;
  filters: AppointmentFilters;
}) {
  /*
    Seleção otimista: a aba acende no toque, não quando o servidor responde.
    A consulta muda de faixa (dia, semana, mês) a cada troca e demora o
    suficiente para o toque parecer ignorado — era a queixa literal, "não tem
    nenhum feedback e demora".

    `aria-current` continua seguindo a `view` real: pintar a aba é uma promessa
    visual, dizer ao leitor de tela que a página já é outra seria mentira.
  */
  const [clicked, setClicked] = useState<AgendaView | null>(null);
  const [lastView, setLastView] = useState(view);
  if (lastView !== view) {
    // Chegou a página nova (ou o usuário voltou pelo histórico): a promessa
    // virou fato e o palpite local sai de cena.
    setLastView(view);
    setClicked(null);
  }
  const activeView = clicked ?? view;

  return (
    <div
      /*
        Sem `relative` de propósito: a barra de progresso de cada aba é
        `absolute` e precisa se resolver contra a faixa da toolbar inteira,
        não contra o segmentado. Uma faixa só, atravessando a largura.
      */
      className="grid min-w-0 flex-1 grid-cols-4 gap-0.5 rounded-full border border-border/70 bg-muted/50 p-0.5 text-sm sm:flex sm:flex-none sm:items-center"
      role="group"
      aria-label="Modo de visualização"
    >
      {viewOptions.map((option) => (
        <Link
          key={option.value}
          href={
            option.value === "semana" || option.value === "dia"
              ? buildAgendaHref({ view: option.value, dateKey, filters })
              : buildAgendaHref({ view: option.value, monthKey, filters })
          }
          aria-current={view === option.value ? "page" : undefined}
          // Estado visual (otimista), separado do `aria-current` (real).
          data-active={activeView === option.value ? "true" : undefined}
          onClick={() => setClicked(option.value)}
          className={cn(
            // Grupo pilula (rounded-full): a aba interna tambem e pilula, e a
            // ativa usa o gradiente da marca (linguagem 2.0).
            "flex min-h-11 min-w-0 items-center justify-center rounded-full px-1 py-1.5 text-center text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:min-h-0 sm:px-3 sm:text-sm",
            activeView === option.value
              ? "bg-brand-gradient text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          )}
        >
          <span className="truncate">{option.label}</span>
          <AgendaLinkProgress />
        </Link>
      ))}
    </div>
  );
}
