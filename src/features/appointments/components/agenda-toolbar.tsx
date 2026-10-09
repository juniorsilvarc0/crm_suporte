"use client";

import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { AgendaLinkProgress } from "@/features/appointments/components/agenda-nav-progress";
import { AgendaViewTabs } from "@/features/appointments/components/agenda-view-tabs";
import { agendaStepHrefs, agendaTitle, type AgendaPeriod } from "@/features/appointments/lib/agenda-view";
import { cn } from "@/lib/utils";

/**
 * Faixa de controles da Agenda — duas linhas no telefone, nenhuma só de um
 * controle (UI.md §5.20): `Hoje` · ‹ › · título do período, e depois as abas,
 * a contagem e o "Novo agendamento" (só o ícone abaixo de `sm`).
 */
export function AgendaToolbar({
  period,
  todayKey,
  count,
  onCreate,
}: {
  period: AgendaPeriod;
  todayKey: string;
  count: number;
  onCreate: () => void;
}) {
  const hrefs = agendaStepHrefs(period, todayKey);

  return (
    // `relative`: é contra esta faixa que a barra de progresso dos links se
    // resolve (AgendaNavProgress).
    <div className="relative flex shrink-0 flex-col gap-2 border-b border-border/70 bg-card px-3 py-2 sm:py-2.5 lg:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href={hrefs.today}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 shrink-0 px-3 sm:h-9 sm:px-3.5")}
        >
          Hoje
          <AgendaLinkProgress />
        </Link>
        <div className="flex shrink-0 items-center">
          <Link
            href={hrefs.previous}
            aria-label="Período anterior"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "size-11 text-muted-foreground hover:text-foreground sm:size-9"
            )}
          >
            <ChevronLeftIcon aria-hidden />
            <AgendaLinkProgress />
          </Link>
          <Link
            href={hrefs.next}
            aria-label="Próximo período"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "size-11 text-muted-foreground hover:text-foreground sm:size-9"
            )}
          >
            <ChevronRightIcon aria-hidden />
            <AgendaLinkProgress />
          </Link>
        </div>
        <h2 className="min-w-0 flex-1 truncate px-0.5 font-heading text-base font-medium sm:text-xl">
          {agendaTitle(period)}
        </h2>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <AgendaViewTabs period={period} />
        {/* A palavra some no telefone; o número fica, e o `aria-live` avisa quem não vê. */}
        <p aria-live="polite" className="shrink-0 text-sm tabular-nums text-muted-foreground sm:ml-auto">
          {count}
          <span className="max-sm:sr-only"> {count === 1 ? "agendamento" : "agendamentos"}</span>
        </p>
        <Button
          type="button"
          onClick={onCreate}
          aria-label="Novo agendamento"
          // `min-w-11`: sem rótulo o botão encolheria abaixo do alvo de toque.
          className="h-11 min-w-11 shrink-0 sm:h-9 sm:min-w-0"
        >
          <PlusIcon data-icon="inline-start" />
          <span className="hidden sm:inline">Novo agendamento</span>
        </Button>
      </div>
    </div>
  );
}
