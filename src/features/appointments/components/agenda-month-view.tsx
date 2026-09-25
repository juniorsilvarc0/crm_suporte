"use client";

import { useMemo, useState } from "react";
import { CalendarOffIcon, Clock3Icon } from "lucide-react";

import { EmptyState } from "@/components/data-display/empty-state";
import { AppointmentDetailsDialog } from "@/features/appointments/components/appointment-details-dialog";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import {
  blockDateKeys,
  describeAgendaBlockForDate,
  type AgendaBlock,
} from "@/features/appointments/lib/agenda-blocks";
import type { Appointment } from "@/features/appointments/types";
import {
  dateKeyToAppDate,
  formatDayNumber,
  formatLongDate,
  formatTime,
} from "@/lib/formatters/date";
import { cn } from "@/lib/utils";
import {
  appointmentToneClass,
  capitalizeFirst,
  formatDisplayMonthTitle,
  formatTipoEnsaio,
  formatWeekdayLong,
  weekDays,
  type DayGroup,
} from "@/features/appointments/components/agenda-utils";

export function MonthCalendar({
  days,
  blocks,
  monthKey,
  todayKey,
}: {
  days: DayGroup[];
  blocks: AgendaBlock[];
  monthKey: string;
  todayKey: string;
}) {
  const weeks = Math.max(1, Math.ceil(days.length / 7));
  // Um mapa dia → bloqueios, montado uma vez. Percorrer todos dentro
  // de cada uma das 42 células seria o mesmo trabalho 42 vezes.
  const blockByDay = new Map<string, AgendaBlock[]>();
  for (const block of blocks) {
    for (const key of blockDateKeys(block)) {
      const current = blockByDay.get(key);
      if (current) current.push(block);
      else blockByDay.set(key, [block]);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="hidden h-full min-h-0 flex-col md:flex">
        <div className="grid shrink-0 grid-cols-7 border-b border-border/70 bg-card">
          {weekDays.map((day) => (
            <div
              key={day}
              className="px-3 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>
        <div
          className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden bg-border/60"
          style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
          role="grid"
          aria-label={`Calendário de ${formatDisplayMonthTitle(monthKey)}`}
        >
          {days.map((day, index) => (
            <MonthDayCell
              key={day.key}
              day={day}
              blocks={blockByDay.get(day.key) ?? []}
              todayKey={todayKey}
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
        blockByDay={blockByDay}
        monthKey={monthKey}
        todayKey={todayKey}
      />
    </section>
  );
}

function MonthDayCell({
  day,
  blocks,
  todayKey,
  className,
}: {
  day: DayGroup;
  blocks: AgendaBlock[];
  todayKey: string;
  className?: string;
}) {
  const isToday = day.key === todayKey;
  const date = dateKeyToAppDate(day.key);
  const label = date ? formatLongDate(date) : day.key;
  const descriptions = blocks.flatMap((block) => {
    const description = describeAgendaBlockForDate(block, day.key);
    return description ? [description] : [];
  });
  const hasAllDayBlock = descriptions.some((description) => description.kind === "all-day");
  const hasPartialBlock = descriptions.some((description) => description.kind === "partial");
  const blockCoverage = hasAllDayBlock
    ? hasPartialBlock ? "mixed" : "all-day"
    : hasPartialBlock ? "partial" : undefined;
  const blockSummary = descriptions.map((description) => description.label).join("; ");

  return (
    <section
      role="gridcell"
      aria-label={
        blockSummary
          ? `${label}, ${day.appointments.length} agendamento(s), bloqueios: ${blockSummary}`
          : `${label}, ${day.appointments.length} agendamento(s)`
      }
      data-block-coverage={blockCoverage}
      className={cn(
        "group/day-cell flex min-h-0 min-w-0 flex-col overflow-hidden bg-card p-1.5 transition-colors",
        !day.inCurrentMonth && "bg-muted/25 text-muted-foreground",
        isToday && "bg-primary/[0.035]",
        hasAllDayBlock &&
          "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0,var(--color-muted)_6px,transparent_6px,transparent_12px)]",
        className
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 pb-1.5">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            isToday
              ? "bg-primary text-primary-foreground"
              : day.inCurrentMonth
                ? "text-foreground"
                : "text-muted-foreground/60"
          )}
        >
          {formatDayNumber(date)}
        </span>
        <span className="shrink-0 opacity-0 transition-opacity group-hover/day-cell:opacity-100 focus-within:opacity-100">
          <AppointmentDialog
            trigger={{ kind: "new", dateKey: day.key }}
            triggerLabel="Agendar"
            triggerAriaLabel={`Agendar em ${label}`}
            triggerVariant="ghost"
            triggerSize="icon-sm"
            triggerClassName="size-6 text-muted-foreground hover:text-foreground"
            iconOnly
          />
        </span>
      </div>

      <div className="studio-calendar-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1">
        {blocks.map((block) => (
          <AgendaBlockRow key={block.id} block={block} dateKey={day.key} />
        ))}
        {day.appointments.map((appointment) => (
          <MonthEventPill key={appointment.id} appointment={appointment} />
        ))}
      </div>
    </section>
  );
}

function MobileMonthAgenda({
  days,
  blockByDay,
  monthKey,
  todayKey,
}: {
  days: DayGroup[];
  blockByDay: Map<string, AgendaBlock[]>;
  monthKey: string;
  todayKey: string;
}) {
  const initialKey = useMemo(() => resolveInitialDayKey(days, todayKey), [days, todayKey]);
  const [selectedKey, setSelectedKey] = useState(initialKey);
  const selectedDay = days.find((day) => day.key === selectedKey) ?? days.find((day) => day.key === initialKey);
  const selectedLabel = selectedDay
    ? capitalizeFirst(formatWeekdayLong(selectedDay.key))
    : "";
  const selectedBlocks = selectedDay ? blockByDay.get(selectedDay.key) ?? [] : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 md:hidden [-webkit-overflow-scrolling:touch]">
      <div className="shrink-0 rounded-xl border border-border/60 bg-card">
        <div className="grid grid-cols-7 border-b border-border/70 px-1.5 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground">
          {weekDays.map((day) => (
            <span key={day}>{day.slice(0, 1)}</span>
          ))}
        </div>
        <div
          className="grid grid-cols-7 gap-1 p-1.5"
          role="grid"
          aria-label={`Calendário de ${formatDisplayMonthTitle(monthKey)}`}
        >
          {days.map((day) => {
            const isToday = day.key === todayKey;
            const isSelected = day.key === selectedKey;
            const count = day.appointments.length;
            const date = dateKeyToAppDate(day.key);
            const label = date ? formatLongDate(date) : day.key;
            const dayBlocks = blockByDay.get(day.key) ?? [];
            const descriptions = dayBlocks.flatMap((block) => {
              const description = describeAgendaBlockForDate(block, day.key);
              return description ? [description] : [];
            });
            const hasAllDayBlock = descriptions.some(
              (description) => description.kind === "all-day"
            );
            const hasPartialBlock = descriptions.some(
              (description) => description.kind === "partial"
            );
            const blockSummary = descriptions.map((description) => description.label).join("; ");

            return (
              <button
                key={day.key}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-current={isToday ? "date" : undefined}
                aria-label={
                  blockSummary
                    ? `${label}, ${count} agendamento(s), bloqueios: ${blockSummary}`
                    : `${label}, ${count} agendamento(s)`
                }
                tabIndex={0}
                onClick={() => setSelectedKey(day.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedKey(day.key);
                  }
                }}
                className={cn(
                  "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border px-0.5 py-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  !day.inCurrentMonth && "border-transparent bg-transparent text-muted-foreground/50",
                  day.inCurrentMonth && !isSelected && "border-border/60 bg-background text-foreground",
                  isToday && !isSelected && "border-primary/40 bg-primary/10 text-primary",
                  isSelected && "border-primary bg-primary text-primary-foreground",
                  // Só dia inteiro recebe hachura. Horário parcial usa relógio.
                  hasAllDayBlock &&
                    !isSelected &&
                    "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0,var(--color-muted)_4px,transparent_4px,transparent_9px)]"
                )}
              >
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    hasAllDayBlock && "line-through decoration-from-font"
                  )}
                >
                  {formatDayNumber(date)}
                </span>
                <span className="flex h-4 min-w-0 items-center justify-center gap-0.5" aria-hidden>
                  {count > 0 ? (
                    <span
                      className={cn(
                        "min-w-4 rounded-full px-1 text-[10px] font-semibold tabular-nums leading-4",
                        isSelected
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-primary/15 text-primary"
                      )}
                    >
                      {count > 9 ? "9+" : count}
                    </span>
                  ) : null}
                  {hasPartialBlock ? <Clock3Icon className="size-3 shrink-0 opacity-80" /> : null}
                  {hasAllDayBlock ? (
                    <CalendarOffIcon className="size-3 shrink-0 opacity-80" />
                  ) : null}
                  {count === 0 && !hasPartialBlock && !hasAllDayBlock ? (
                    <span className="size-1 rounded-full bg-transparent" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col gap-3" aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-heading text-base font-semibold">{selectedLabel}</h3>
            <p className="text-xs text-muted-foreground">
              {selectedDay?.appointments.length ?? 0}{" "}
              {(selectedDay?.appointments.length ?? 0) === 1 ? "agendamento" : "agendamentos"}
            </p>
            {selectedBlocks.length > 0 ? (
              <div className="mt-2 grid min-w-0 gap-1">
                {selectedBlocks.map((block) => (
                  <AgendaBlockRow
                    key={block.id}
                    block={block}
                    dateKey={selectedDay?.key ?? ""}
                    className="py-1.5 text-xs"
                  />
                ))}
              </div>
            ) : null}
          </div>
          {selectedDay ? (
            <AppointmentDialog
              trigger={{ kind: "new", dateKey: selectedDay.key }}
              triggerLabel="Agendar"
              triggerVariant="outline"
              triggerSize="sm"
              triggerClassName="h-11 shrink-0 px-3 sm:h-8"
            />
          ) : null}
        </div>

        {!selectedDay || selectedDay.appointments.length === 0 ? (
          <EmptyState>Nenhum agendamento neste dia.</EmptyState>
        ) : (
          <div className="grid gap-2 pb-3">
            {selectedDay.appointments.map((appointment) => (
              <MobileMonthEventCard key={appointment.id} appointment={appointment} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AgendaBlockRow({
  block,
  dateKey,
  className,
}: {
  block: AgendaBlock;
  dateKey: string;
  className?: string;
}) {
  const description = describeAgendaBlockForDate(block, dateKey);
  if (!description) return null;

  const Icon = description.kind === "all-day" ? CalendarOffIcon : Clock3Icon;

  return (
    <p
      data-slot="agenda-block-row"
      title={description.label}
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] font-medium leading-snug text-muted-foreground",
        description.kind === "all-day"
          ? "border-transparent bg-muted"
          : "border-border/80 bg-background/90",
        className
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{description.reason}</span>
      <span className="shrink-0" aria-hidden>·</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{description.period}</span>
    </p>
  );
}

function MobileMonthEventCard({ appointment }: { appointment: Appointment }) {
  return (
    <AppointmentDetailsDialog
      appointment={appointment}
      triggerClassName="w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span
        className={cn(
          "block min-w-0 rounded-xl border border-border/70 px-3 py-3 text-left transition-colors hover:bg-muted/30",
          appointmentToneClass(appointment)
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatTime(appointment.scheduled_at)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {appointment.leads?.name ?? "Sem nome"}
          </span>
        </span>
        <span className="mt-1 block truncate text-xs font-medium opacity-80">
          {formatTipoEnsaio(appointment.tipo_ensaio)}
        </span>
      </span>
    </AppointmentDetailsDialog>
  );
}

function MonthEventPill({ appointment }: { appointment: Appointment }) {
  return (
    <AppointmentDetailsDialog
      appointment={appointment}
      triggerClassName="w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span
        className={cn(
          "block min-w-0 rounded-lg px-1.5 py-1 text-left transition-[filter] hover:brightness-[0.98]",
          appointmentToneClass(appointment)
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[11px] font-semibold tabular-nums">
            {formatTime(appointment.scheduled_at)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-snug">
            {appointment.leads?.name ?? "Sem nome"}
          </span>
        </span>
        <span className="block truncate pl-[3.35rem] text-[10px] font-medium leading-tight opacity-75">
          {formatTipoEnsaio(appointment.tipo_ensaio)}
        </span>
      </span>
    </AppointmentDetailsDialog>
  );
}

function resolveInitialDayKey(days: DayGroup[], todayKey: string) {
  const today = days.find((day) => day.key === todayKey);
  if (today) return today.key;

  const withAppointments = days.find((day) => day.inCurrentMonth && day.appointments.length > 0);
  if (withAppointments) return withAppointments.key;

  const firstInMonth = days.find((day) => day.inCurrentMonth);
  return firstInMonth?.key ?? days[0]?.key ?? todayKey;
}
