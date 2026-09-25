import { AgendaFilterBar } from "@/features/appointments/components/agenda-filter-bar";
import { AgendaToolbar } from "@/features/appointments/components/agenda-toolbar";
import { MonthCalendar } from "@/features/appointments/components/agenda-month-view";
import { MonthAgendaList } from "@/features/appointments/components/agenda-list-view";
import { TimeGridView } from "@/features/appointments/components/agenda-time-grid";
import {
  buildTipoFilterOptions,
  compareAppointments,
  matchesAppointmentFilters,
  type AgendaView,
  type AppointmentFilters,
  type DayGroup,
} from "@/features/appointments/components/agenda-utils";
import type { AgendaBlock } from "@/features/appointments/lib/agenda-blocks";
import type { Appointment, AppointmentBoardItem } from "@/features/appointments/types";
import {
  getMonthDateKeys,
  getTodayAppDateKey,
  toAppDateKey,
} from "@/lib/formatters/date";

export function AppointmentsTable({
  items,
  blocks,
  monthKey,
  dateKey,
  view,
  filters,
}: {
  items: AppointmentBoardItem[];
  blocks: AgendaBlock[];
  monthKey: string;
  dateKey: string;
  view: AgendaView;
  filters: AppointmentFilters;
}) {
  const allAppointments = items
    .filter((item): item is Extract<AppointmentBoardItem, { kind: "appointment" }> => {
      return item.kind === "appointment";
    })
    .map((item) => item.appointment)
    .sort(compareAppointments);

  const appointments = allAppointments.filter((appointment) => {
    return matchesAppointmentFilters(appointment, filters);
  });

  // Sobre `allAppointments`, não sobre a lista já filtrada: escolher um serviço
  // no filtro não pode fazer os outros sumirem da própria lista de opções.
  const tipoOptions = buildTipoFilterOptions(allAppointments);

  const todayKey = getTodayAppDateKey();
  const monthDays = getMonthDateKeys(monthKey);
  const grouped = new Map<string, Appointment[]>(
    monthDays.map((dayKey) => [dayKey, []])
  );

  for (const appointment of appointments) {
    const key = toAppDateKey(appointment.scheduled_at);
    grouped.get(key)?.push(appointment);
  }

  const days: DayGroup[] = monthDays.map((dayKey) => ({
    key: dayKey,
    appointments: grouped.get(dayKey) ?? [],
    inCurrentMonth: dayKey.startsWith(monthKey),
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <AgendaToolbar
          monthKey={monthKey}
          dateKey={dateKey}
          view={view}
          filters={filters}
          todayKey={todayKey}
        />
        <AgendaFilterBar
          monthKey={monthKey}
          dateKey={dateKey}
          view={view}
          status={filters.status ?? ""}
          tipo={filters.tipo ?? ""}
          q={filters.q ?? ""}
          resultCount={appointments.length}
          tipoOptions={tipoOptions}
        />
      </div>

      <div className="min-h-0 flex-1">
        {view === "month" ? (
          <MonthCalendar
            days={days}
            blocks={blocks}
            monthKey={monthKey}
            todayKey={todayKey}
          />
        ) : view === "list" ? (
          <MonthAgendaList days={days} monthKey={monthKey} todayKey={todayKey} />
        ) : (
          <TimeGridView
            mode={view === "semana" ? "week" : "day"}
            dateKey={dateKey}
            appointments={appointments}
            blocks={blocks}
            todayKey={todayKey}
          />
        )}
      </div>
    </div>
  );
}
