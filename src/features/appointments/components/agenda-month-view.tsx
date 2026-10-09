"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";

import { EmptyState } from "@/components/data-display/empty-state";
import { Button } from "@/components/ui/button";
import { AgendaEvent } from "@/features/appointments/components/agenda-event";
import { WEEK_DAYS, agendaTitle, capitalizeFirst } from "@/features/appointments/lib/agenda-view";
import type { AppointmentListItem } from "@/features/appointments/types";
import { dateKeyToAppDate, formatDayNumber, formatLongDate } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

export type AgendaDay = {
  key: string;
  appointments: AppointmentListItem[];
  inCurrentMonth: boolean;
};

type MonthViewProps = {
  days: AgendaDay[];
  monthKey: string;
  todayKey: string;
  onOpen: (appointment: AppointmentListItem) => void;
  onCreate: (dateKey: string) => void;
};

/**
 * O mês: grade de 7 colunas a partir de `md`; no telefone, um minicalendário
 * e a lista do dia escolhido (sete colunas legíveis não cabem em 390 px).
 */
export function AgendaMonthView({ days, monthKey, todayKey, onOpen, onCreate }: MonthViewProps) {
  const weeks = Math.max(1, Math.ceil(days.length / 7));
  const monthLabel = agendaTitle({ view: "mes", monthKey, dateKey: todayKey });

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="hidden h-full min-h-0 flex-col md:flex">
        <div className="grid shrink-0 grid-cols-7 border-b border-border/70 bg-card">
          {WEEK_DAYS.map((day) => (
            <div key={day} className="px-3 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground">
              {day}
            </div>
          ))}
        </div>
        <div
          role="grid"
          aria-label={`Calendário de ${monthLabel}`}
          className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden bg-border/60"
          style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
        >
          {days.map((day, index) => (
            <MonthDayCell
              key={day.key}
              day={day}
              todayKey={todayKey}
              onOpen={onOpen}
              onCreate={onCreate}
              className={cn(
                index % 7 !== 6 && "border-r border-border/50",
                index < days.length - 7 && "border-b border-border/50"
              )}
            />
          ))}
        </div>
      </div>

      <MobileMonthAgenda
        key={monthKey}
        days={days}
        monthLabel={monthLabel}
        todayKey={todayKey}
        onOpen={onOpen}
        onCreate={onCreate}
      />
    </section>
  );
}

function dayLabel(dateKey: string): string {
  return capitalizeFirst(formatLongDate(dateKeyToAppDate(dateKey)));
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "agendamento" : "agendamentos"}`;
}

function MonthDayCell({
  day,
  todayKey,
  onOpen,
  onCreate,
  className,
}: {
  day: AgendaDay;
  todayKey: string;
  onOpen: (appointment: AppointmentListItem) => void;
  onCreate: (dateKey: string) => void;
  className?: string;
}) {
  const isToday = day.key === todayKey;
  const label = dayLabel(day.key);

  return (
    <section
      role="gridcell"
      aria-label={`${label}, ${countLabel(day.appointments.length)}`}
      className={cn(
        "group/day-cell flex min-h-0 min-w-0 flex-col overflow-hidden bg-card p-1.5 transition-colors",
        !day.inCurrentMonth && "bg-muted/25 text-muted-foreground",
        isToday && "bg-primary/[0.035]",
        className
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 pb-1.5">
        <span
          aria-current={isToday ? "date" : undefined}
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            isToday
              ? "bg-primary text-primary-foreground"
              : day.inCurrentMonth
                ? "text-foreground"
                : "text-muted-foreground/60"
          )}
        >
          {formatDayNumber(day.key)}
        </span>
        {/* No toque não há hover: lá o "+" fica sempre visível. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Agendar em ${label}`}
          onClick={() => onCreate(day.key)}
          className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/day-cell:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <PlusIcon />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-0.5">
        {day.appointments.map((appointment) => (
          <AgendaEvent key={appointment.id} appointment={appointment} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

/** Hoje, se o mês é o corrente; senão o 1º dia do mês com compromisso; senão o dia 1º. */
function resolveInitialDayKey(days: AgendaDay[], todayKey: string): string {
  if (days.some((day) => day.key === todayKey && day.inCurrentMonth)) return todayKey;
  const withAppointments = days.find((day) => day.inCurrentMonth && day.appointments.length > 0);
  if (withAppointments) return withAppointments.key;
  return days.find((day) => day.inCurrentMonth)?.key ?? days[0]?.key ?? todayKey;
}

function MobileMonthAgenda({
  days,
  monthLabel,
  todayKey,
  onOpen,
  onCreate,
}: {
  days: AgendaDay[];
  monthLabel: string;
  todayKey: string;
  onOpen: (appointment: AppointmentListItem) => void;
  onCreate: (dateKey: string) => void;
}) {
  const initialKey = useMemo(() => resolveInitialDayKey(days, todayKey), [days, todayKey]);
  const [selectedKey, setSelectedKey] = useState(initialKey);
  const selectedDay = days.find((day) => day.key === selectedKey) ?? days.find((day) => day.key === initialKey);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 md:hidden [-webkit-overflow-scrolling:touch]">
      <div className="shrink-0 rounded-xl border border-border/60 bg-card">
        <div className="grid grid-cols-7 border-b border-border/70 px-1.5 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground">
          {WEEK_DAYS.map((day) => (
            <span key={day} aria-hidden>
              {day.slice(0, 1)}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={`Calendário de ${monthLabel}`} className="grid grid-cols-7 gap-1 p-1.5">
          {days.map((day) => {
            const isToday = day.key === todayKey;
            const isSelected = day.key === selectedDay?.key;
            const count = day.appointments.length;
            return (
              <button
                key={day.key}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${dayLabel(day.key)}, ${countLabel(count)}`}
                onClick={() => setSelectedKey(day.key)}
                className={cn(
                  "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border px-0.5 py-1 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                  !day.inCurrentMonth && "border-transparent bg-transparent text-muted-foreground/50",
                  day.inCurrentMonth && !isSelected && "border-border/60 bg-background text-foreground",
                  isToday && !isSelected && "border-primary/40 bg-primary/10 text-primary",
                  isSelected && "border-primary bg-primary text-primary-foreground"
                )}
              >
                <span className="text-sm font-semibold tabular-nums">{formatDayNumber(day.key)}</span>
                <span className="flex h-4 items-center justify-center" aria-hidden>
                  {count > 0 ? (
                    <span
                      className={cn(
                        "min-w-4 rounded-full px-1 text-[10px] font-semibold tabular-nums leading-4",
                        isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary"
                      )}
                    >
                      {count > 9 ? "9+" : count}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section aria-live="polite" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-heading text-base font-semibold">
              {selectedDay ? dayLabel(selectedDay.key) : ""}
            </h3>
            <p className="text-xs text-muted-foreground">{countLabel(selectedDay?.appointments.length ?? 0)}</p>
          </div>
          {selectedDay ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCreate(selectedDay.key)}
              className="h-11 shrink-0 px-3"
            >
              <PlusIcon data-icon="inline-start" />
              Agendar
            </Button>
          ) : null}
        </div>

        {!selectedDay || selectedDay.appointments.length === 0 ? (
          <EmptyState>Nenhum agendamento neste dia.</EmptyState>
        ) : (
          <div className="grid gap-2 pb-3">
            {selectedDay.appointments.map((appointment) => (
              <AgendaEvent key={appointment.id} appointment={appointment} onOpen={onOpen} size="comfortable" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
