"use client";

import Link from "next/link";
import { CalendarPlusIcon, ChevronLeftIcon, ChevronRightIcon, Maximize2Icon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { WeekCalendar } from "@/features/home/components/week-calendar";
import type { HomeWeek } from "@/features/home/lib/week";
import type { HomeAppointment, HomeSummary } from "@/features/home/types";
import { formatShortDate } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

/** "10/08 – 16/08 de 2026" — a partir das chaves de dia, já no fuso do app. */
function rangeLabel(dayKeys: string[]): string {
  const first = dayKeys[0];
  const last = dayKeys[dayKeys.length - 1];
  if (!first || !last) return "";
  return `${formatShortDate(`${first}T12:00:00Z`)} – ${formatShortDate(`${last}T12:00:00Z`)} de ${last.slice(0, 4)}`;
}

/**
 * Coluna da agenda: ações, navegação da semana, resumo e a grade.
 *
 * A navegação é por LINK (`?semana=`), não estado local: assim o preview
 * sobrevive a recarga, volta com o botão do navegador e pode ser colado no
 * WhatsApp — e os dados vêm do servidor já filtrados pela semana.
 */
export function AgendaPanel({
  week,
  appointments,
  summary,
}: {
  week: HomeWeek;
  appointments: HomeAppointment[];
  summary: HomeSummary;
}) {
  return (
    <section
      aria-labelledby="home-agenda-title"
      className="flex min-h-0 flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-soft sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="home-agenda-title" className="sr-only">
          Agenda da semana
        </h2>
        {/* Links com aparência de botão (padrão de `agenda-toolbar`): navegação
            é <a>, e o Button do Base UI exige <button> nativo. */}
        <Link href="/app/agendamentos" className={cn(buttonVariants(), "h-10")}>
          <CalendarPlusIcon data-icon="inline-start" />
          Agendar sessão
        </Link>
        <Link
          href="/app/agendamentos"
          aria-label="Abrir a agenda completa"
          className={cn(buttonVariants({ variant: "outline" }), "ml-auto h-10")}
        >
          <Maximize2Icon data-icon="inline-start" />
          Expandir
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={`/app?semana=${week.previousKey}`}
            scroll={false}
            aria-label="Semana anterior"
            className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "size-9")}
          >
            <ChevronLeftIcon />
          </Link>
          <Link
            href={`/app?semana=${week.nextKey}`}
            scroll={false}
            aria-label="Próxima semana"
            className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "size-9")}
          >
            <ChevronRightIcon />
          </Link>
          <Link
            href="/app"
            scroll={false}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-1 h-9")}
          >
            hoje
          </Link>
        </div>
        <p className="ml-auto font-display text-sm font-medium tabular-nums">{rangeLabel(week.dayKeys)}</p>
      </div>

      {/* Resumo: dois números que existem no banco — nada estimado. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border-l-4 border-primary bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cuidando de perto</p>
          <p className="truncate font-display text-sm font-semibold">Pessoas em acompanhamento</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded-full bg-card px-2.5 py-1 font-display text-xs font-semibold tabular-nums shadow-sm">
            {summary.active} ativas
          </span>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 font-display text-xs font-semibold tabular-nums shadow-sm",
              summary.today > 0 ? "bg-brand-gradient text-primary-foreground" : "bg-card"
            )}
          >
            {summary.today} hoje
          </span>
        </div>
      </div>

      {appointments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum atendimento agendado nesta semana.
        </p>
      ) : (
        <WeekCalendar dayKeys={week.dayKeys} appointments={appointments} />
      )}
    </section>
  );
}
