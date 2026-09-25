import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { AgendaSettingsDialog } from "@/features/appointments/components/agenda-settings-dialog";
import { AgendaLinkProgress } from "@/features/appointments/components/agenda-nav-progress";
import { AgendaViewTabs } from "@/features/appointments/components/agenda-view-tabs";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import {
  buildAgendaHref,
  capitalizeFirst,
  formatDisplayMonthTitle,
  type AgendaView,
  type AppointmentFilters,
} from "@/features/appointments/components/agenda-utils";
import {
  addDaysToAppDateKey,
  addMonthsToAppMonthKey,
  dateKeyToAppDate,
  formatDayNumber,
  formatLongDate,
  formatMonthShort,
  getWeekDateKeys,
} from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

/**
 * Faixa de controles da agenda — **duas linhas no telefone**, não quatro.
 *
 * O botão "Novo agendamento" ocupava uma linha inteira em largura total e a
 * engrenagem outra meia; somados à busca e aos filtros, o cromo comia metade da
 * tela e a lista de agendamentos — o motivo de a pessoa abrir esta página —
 * sobrava com pouco mais de um quarto. Agora as ações moram nas pontas das duas
 * linhas que já existiam, sem perder rótulo a partir de `sm`.
 */
export function AgendaToolbar({
  monthKey,
  dateKey,
  view,
  filters,
  todayKey,
}: {
  monthKey: string;
  dateKey: string;
  view: AgendaView;
  filters: AppointmentFilters;
  todayKey: string;
}) {
  const isDateView = view === "semana" || view === "dia";
  const step = view === "semana" ? 7 : 1;
  const previousHref = isDateView
    ? buildAgendaHref({ view, dateKey: addDaysToAppDateKey(dateKey, -step), filters })
    : buildAgendaHref({ view, monthKey: addMonthsToAppMonthKey(monthKey, -1), filters });
  const nextHref = isDateView
    ? buildAgendaHref({ view, dateKey: addDaysToAppDateKey(dateKey, step), filters })
    : buildAgendaHref({ view, monthKey: addMonthsToAppMonthKey(monthKey, 1), filters });
  const todayHref = isDateView
    ? buildAgendaHref({ view, dateKey: todayKey, filters })
    : buildAgendaHref({ view, monthKey: todayKey.slice(0, 7), filters });
  const title = view === "dia"
    ? capitalizeFirst(formatLongDate(dateKeyToAppDate(dateKey)))
    : view === "semana"
      ? formatWeekTitle(dateKey)
      : formatDisplayMonthTitle(monthKey);
  const dateViewMonthKey = isDateView ? dateKey.slice(0, 7) : monthKey;

  return (
    // `relative`: é contra esta faixa que a barra de progresso de cada link se
    // resolve. Ver AgendaNavProgress.
    <div className="relative flex flex-col gap-2 border-b border-border/70 bg-card px-3 py-2 sm:py-2.5 lg:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href={todayHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 shrink-0 px-3 sm:h-9 sm:px-3.5")}
        >
          Hoje
          <AgendaLinkProgress />
        </Link>
        <div className="flex shrink-0 items-center">
          <Link
            href={previousHref}
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
            href={nextHref}
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
        <h2 className="min-w-0 flex-1 truncate px-0.5 font-heading text-base font-medium tracking-normal sm:text-xl">
          {title}
        </h2>
        <AgendaSettingsDialog />
      </div>

      <div className="flex items-center gap-2 sm:justify-between">
        <AgendaViewTabs
          view={view}
          dateKey={dateKey}
          monthKey={dateViewMonthKey}
          filters={filters}
        />
        <AppointmentDialog
          trigger={{ kind: "new", dateKey: isDateView ? dateKey : `${monthKey}-01` }}
          triggerLabel="Novo agendamento"
          triggerLabelClassName="hidden sm:inline"
          // `min-w-11`: sem rótulo o botão encolheria para os 34px do ícone e
          // ficaria abaixo do alvo de toque de 44px.
          triggerClassName="h-11 min-w-11 shrink-0 sm:h-9 sm:min-w-0"
        />
      </div>
    </div>
  );
}

function formatWeekTitle(dateKey: string) {
  const keys = getWeekDateKeys(dateKey);
  if (keys.length < 7) return "";
  return `${formatDayNumber(keys[0])}–${formatDayNumber(keys[6])} de ${formatMonthShort(keys[6])}`;
}
