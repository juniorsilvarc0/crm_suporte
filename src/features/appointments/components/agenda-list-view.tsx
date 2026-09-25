"use client";

import { useState } from "react";

import { EmptyState } from "@/components/data-display/empty-state";
import { FormSelect } from "@/components/forms/form-select";
import { OverlayScrollArea } from "@/components/ui/overlay-scroll-area";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import { AppointmentCard } from "@/features/appointments/components/agenda-appointment-card";
import {
  capitalizeFirst,
  formatDisplayMonthTitle,
  formatWeekdayLong,
  resolveInitialAppointmentDayKey,
  type DayGroup,
} from "@/features/appointments/components/agenda-utils";
import { useMediaQuery } from "@/lib/use-media-query";

export function MonthAgendaList({
  days,
  monthKey,
  todayKey,
}: {
  days: DayGroup[];
  monthKey: string;
  todayKey: string;
}) {
  const appointmentDays = days.filter((day) => {
    return day.inCurrentMonth && day.appointments.length > 0;
  });
  const initialDayKey = resolveInitialAppointmentDayKey(appointmentDays, todayKey);
  const [selectedKey, setSelectedKey] = useState(initialDayKey);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const selectedDay = appointmentDays.find((day) => day.key === selectedKey)
    ?? appointmentDays.find((day) => day.key === initialDayKey);
  const visibleDays = isMobile
    ? selectedDay ? [selectedDay] : []
    : appointmentDays;
  const dayOptions = appointmentDays.map((day) => ({
    value: day.key,
    label: `${capitalizeFirst(formatWeekdayLong(day.key))} · ${day.appointments.length} ${day.appointments.length === 1 ? "agendamento" : "agendamentos"}`,
  }));

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      {/*
        O título e a descrição que ficavam aqui — "Agenda em lista" e
        "Agendamentos de <mês>, agrupados por dia" — não diziam nada que a tela
        já não dissesse: a aba marcada é "Lista" e a toolbar mostra o mês. Eram
        duas linhas de cromo empurrando os agendamentos para baixo. Viraram um
        cabeçalho `sr-only`, que preserva a navegação por títulos de quem usa
        leitor de tela sem cobrar altura de quem enxerga.
      */}
      <h3 className="sr-only">
        Agenda em lista de {formatDisplayMonthTitle(monthKey)}, agrupada por dia
      </h3>

      {appointmentDays.length > 0 ? (
        // Sem rótulo acima: o valor do seletor já é o dia por extenso com a
        // contagem. O nome acessível continua no `aria-label`.
        <div className="shrink-0 md:hidden">
          <FormSelect
            id="agenda-list-day"
            value={selectedDay?.key ?? ""}
            onValueChange={setSelectedKey}
            options={dayOptions}
            aria-label="Escolher dia com agendamento"
          />
        </div>
      ) : null}

      <OverlayScrollArea
        className="min-h-0 flex-1"
        viewportClassName="pr-2 [-webkit-overflow-scrolling:touch]"
      >
        <div className="grid gap-4">
          {appointmentDays.length === 0 ? (
            <EmptyState>Nenhum agendamento encontrado para os filtros atuais.</EmptyState>
          ) : (
            visibleDays.map((day) => (
              <section key={day.key} className="grid gap-3">
                <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold">
                      {capitalizeFirst(formatWeekdayLong(day.key))}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {day.appointments.length}{" "}
                      {day.appointments.length === 1 ? "agendamento" : "agendamentos"}
                    </p>
                  </div>
                  <AppointmentDialog
                    trigger={{ kind: "new", dateKey: day.key }}
                    triggerLabel="Agendar neste dia"
                    triggerVariant="ghost"
                    triggerSize="sm"
                    triggerClassName="h-11 sm:h-8"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {day.appointments.map((appointment) => (
                    <AppointmentCard key={appointment.id} appointment={appointment} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </OverlayScrollArea>
    </section>
  );
}
