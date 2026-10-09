"use client";

import { useState } from "react";

import { AgendaMonthView, type AgendaDay } from "@/features/appointments/components/agenda-month-view";
import { AgendaTimeGrid } from "@/features/appointments/components/agenda-time-grid";
import { AgendaToolbar } from "@/features/appointments/components/agenda-toolbar";
import { AppointmentDialog } from "@/features/appointments/components/appointment-dialog";
import { AppointmentsTable } from "@/features/appointments/components/appointments-table";
import type { AgendaBlock } from "@/features/appointments/lib/agenda-blocks";
import { groupAppointmentsByDay, type AgendaPeriod } from "@/features/appointments/lib/agenda-view";
import type { AppointmentListItem } from "@/features/appointments/types";
import { getMonthDateKeys, toAppDateKey } from "@/lib/formatters/date";

/**
 * A Agenda: faixa de controles + a visão do período (mês, semana, dia ou
 * lista). O período é a URL; aqui só mora o estado dos diálogos — tocar num
 * compromisso abre a edição, e o "+" de um dia abre a criação naquele dia.
 */
export function AgendaCalendar({
  period,
  todayKey,
  appointments,
  blocks,
}: {
  period: AgendaPeriod;
  todayKey: string;
  appointments: AppointmentListItem[];
  /** Os bloqueios que tocam o período (UI.md §5.17); a Lista não os desenha. */
  blocks: AgendaBlock[];
}) {
  // O dia da criação; `null` = diálogo fechado.
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [editing, setEditing] = useState<AppointmentListItem | null>(null);

  // "Novo agendamento" da faixa: o dia em tela (semana/dia) ou, no mês, hoje se
  // for o mês corrente, senão o dia 1º.
  const defaultCreateKey =
    period.view === "semana" || period.view === "dia"
      ? period.dateKey
      : period.monthKey === todayKey.slice(0, 7)
        ? todayKey
        : `${period.monthKey}-01`;

  // A contagem fala do período do título. No mês, a grade também mostra os dias
  // do mês vizinho nas pontas — esses ficam fora da conta de "Outubro de 2026".
  const count =
    period.view === "mes"
      ? appointments.filter((item) => toAppDateKey(item.scheduled_at).startsWith(period.monthKey)).length
      : appointments.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgendaToolbar
        period={period}
        todayKey={todayKey}
        count={count}
        onCreate={() => setCreatingOn(defaultCreateKey)}
      />

      <div className="min-h-0 flex-1">
        {period.view === "mes" ? (
          <AgendaMonthView
            days={monthDays(period.monthKey, appointments)}
            blocks={blocks}
            monthKey={period.monthKey}
            todayKey={todayKey}
            onOpen={setEditing}
            onCreate={setCreatingOn}
          />
        ) : period.view === "lista" ? (
          <div className="h-full overflow-auto overscroll-contain p-3 lg:p-4">
            <AppointmentsTable appointments={appointments} />
          </div>
        ) : (
          <AgendaTimeGrid
            mode={period.view === "semana" ? "week" : "day"}
            dateKey={period.dateKey}
            appointments={appointments}
            blocks={blocks}
            todayKey={todayKey}
            onOpen={setEditing}
            onCreate={setCreatingOn}
          />
        )}
      </div>

      <AppointmentDialog
        dateKey={creatingOn ?? undefined}
        open={creatingOn !== null}
        onOpenChange={(open) => {
          if (!open) setCreatingOn(null);
        }}
      />
      <AppointmentDialog
        appointment={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

function monthDays(monthKey: string, appointments: AppointmentListItem[]): AgendaDay[] {
  const keys = getMonthDateKeys(monthKey);
  const byDay = groupAppointmentsByDay(appointments, keys);
  return keys.map((key) => ({
    key,
    appointments: byDay.get(key) ?? [],
    inCurrentMonth: key.startsWith(monthKey),
  }));
}
