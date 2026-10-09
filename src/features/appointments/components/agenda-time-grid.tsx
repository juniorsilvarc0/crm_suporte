"use client";

import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AgendaEvent } from "@/features/appointments/components/agenda-event";
import { capitalizeFirst, groupAppointmentsByDay, startMinutesOf } from "@/features/appointments/lib/agenda-view";
import {
  GRID_END_HOUR,
  GRID_HEIGHT,
  GRID_START_HOUR,
  HOUR_HEIGHT,
  TWO_LINE_HEIGHT,
  layoutTimeGrid,
} from "@/features/appointments/lib/time-grid-layout";
import type { AppointmentListItem } from "@/features/appointments/types";
import {
  dateKeyToAppDate,
  formatDayNumber,
  formatLongDate,
  formatWeekdayShort,
  getWeekDateKeys,
} from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, index) => GRID_START_HOUR + index);

/**
 * Semana e dia numa grade de horários (UI.md §5.15). Compromissos que se
 * cruzam viram faixas lado a lado (`layoutTimeGrid`); fora da grade, encostam
 * na borda em vez de sumir.
 */
export function AgendaTimeGrid({
  mode,
  dateKey,
  appointments,
  todayKey,
  onOpen,
  onCreate,
}: {
  mode: "week" | "day";
  dateKey: string;
  appointments: AppointmentListItem[];
  todayKey: string;
  onOpen: (appointment: AppointmentListItem) => void;
  onCreate: (dateKey: string) => void;
}) {
  const dayKeys = mode === "week" ? getWeekDateKeys(dateKey) : [dateKey];
  const byDay = groupAppointmentsByDay(appointments, dayKeys);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {/* Sete colunas não cabem num telefone: a semana rola na horizontal com piso; o dia ocupa o que tiver. */}
        <div className={cn("min-w-0", mode === "week" && "min-w-[45rem]")}>
          <div className="sticky top-0 z-20 flex border-b border-border/70 bg-card">
            <div className="w-10 shrink-0 sm:w-12" />
            {dayKeys.map((key) => {
              const date = dateKeyToAppDate(key);
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className="group/day-column flex min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-border/40 py-2"
                >
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {formatWeekdayShort(date)}
                  </span>
                  <span
                    aria-current={isToday ? "date" : undefined}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      isToday && "bg-primary text-primary-foreground"
                    )}
                  >
                    {formatDayNumber(date)}
                  </span>
                  {/* ⚠️ `hover:` do Tailwind v4 só existe com cursor: no toque o "+" fica sempre visível. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Agendar em ${capitalizeFirst(formatLongDate(date))}`}
                    onClick={() => onCreate(key)}
                    className="size-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/day-column:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <PlusIcon />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex">
            <div className="w-10 shrink-0 sm:w-12" aria-hidden>
              {HOURS.map((hour) => (
                <div key={hour} style={{ height: HOUR_HEIGHT }} className="relative">
                  <span className="absolute -top-2 right-1.5 text-[10px] tabular-nums text-muted-foreground">
                    {String(hour).padStart(2, "0")}h
                  </span>
                </div>
              ))}
            </div>
            {dayKeys.map((key) => (
              <DayColumn key={key} appointments={byDay.get(key) ?? []} onOpen={onOpen} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DayColumn({
  appointments,
  onOpen,
}: {
  appointments: AppointmentListItem[];
  onOpen: (appointment: AppointmentListItem) => void;
}) {
  const placements = layoutTimeGrid(
    appointments.map((appointment) => ({
      id: appointment.id,
      startMinutes: startMinutesOf(appointment.scheduled_at),
      durationMin: appointment.duration_min ?? 60,
    }))
  );
  const byId = new Map(appointments.map((appointment) => [appointment.id, appointment]));

  return (
    <div className="relative min-w-0 flex-1 border-l border-border/40" style={{ height: GRID_HEIGHT }}>
      {HOURS.map((hour) => (
        <div key={hour} style={{ height: HOUR_HEIGHT }} className="border-b border-border/30" />
      ))}

      {placements.map((placement) => {
        const appointment = byId.get(placement.id);
        if (!appointment) return null;
        return (
          <div
            key={placement.id}
            // 2 px em volta: separa faixas vizinhas e descola o card da linha da grade.
            className="absolute p-0.5"
            style={{
              top: placement.top,
              height: placement.height,
              left: `${placement.leftPct}%`,
              width: `${placement.widthPct}%`,
            }}
          >
            <AgendaEvent
              appointment={appointment}
              onOpen={onOpen}
              twoLines={placement.height >= TWO_LINE_HEIGHT}
              className="h-full"
            />
          </div>
        );
      })}
    </div>
  );
}
