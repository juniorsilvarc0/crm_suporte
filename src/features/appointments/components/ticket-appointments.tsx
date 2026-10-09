"use client";

import { useState } from "react";
import { CalendarClockIcon, PencilIcon, PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AppointmentDialog,
  type AppointmentTicketContext,
} from "@/features/appointments/components/appointment-dialog";
import { appointmentKindColor, appointmentKindLabel } from "@/features/appointments/lib/appointment-kind";
import {
  appointmentStatusColor,
  appointmentStatusLabel,
} from "@/features/appointments/lib/appointment-status";
import type { AppointmentListItem } from "@/features/appointments/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatDateTime } from "@/lib/formatters/date";

/**
 * Os compromissos de um ticket, na ficha dele: "Agendar" abre o diálogo da
 * Agenda já ligado ao ticket (contato e empresa vêm do `context`). Excluir fica
 * na Agenda; aqui se cria e se edita (inclusive cancelar, pela situação).
 */
export function TicketAppointments({
  context,
  appointments,
  editable,
}: {
  context: AppointmentTicketContext;
  appointments: AppointmentListItem[];
  editable: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AppointmentListItem | null>(null);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Agendamentos</h3>
        {editable ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)} className="h-9">
            <PlusIcon data-icon="inline-start" />
            Agendar
          </Button>
        ) : null}
      </div>

      {appointments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum agendamento.</p>
      ) : (
        <ul className="grid gap-2">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="grid gap-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <Badge variant="outline" className={getColorStyle(appointmentKindColor[appointment.kind]).badge}>
                    {appointmentKindLabel[appointment.kind]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={getColorStyle(appointmentStatusColor[appointment.status]).badge}
                  >
                    {appointmentStatusLabel[appointment.status]}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <CalendarClockIcon className="size-3.5" aria-hidden />
                    {formatDateTime(appointment.scheduled_at)}
                  </span>
                </div>
                {editable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Editar agendamento"
                    onClick={() => setEditing(appointment)}
                    className="-me-1 -mt-1 size-8 shrink-0"
                  >
                    <PencilIcon />
                  </Button>
                ) : null}
              </div>

              {appointment.title?.trim() ? (
                <p className="break-words text-sm">{appointment.title.trim()}</p>
              ) : null}

              {appointment.assignee || appointment.location?.trim() ? (
                <p className="break-words text-xs text-muted-foreground">
                  {[appointment.assignee?.name, appointment.location?.trim()].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Criar (com o vínculo do ticket) e editar: o mesmo diálogo da Agenda. */}
      <AppointmentDialog context={context} open={creating} onOpenChange={setCreating} />
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
