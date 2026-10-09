"use client";

import { CheckIcon } from "lucide-react";

import { appointmentTimeRange } from "@/features/appointments/lib/agenda-view";
import { appointmentKindColor, appointmentKindLabel } from "@/features/appointments/lib/appointment-kind";
import { appointmentStatusLabel } from "@/features/appointments/lib/appointment-status";
import type { AppointmentListItem } from "@/features/appointments/types";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { formatTime } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

/** A linha principal: o assunto, ou o tipo quando não há assunto. */
export function appointmentHeadline(appointment: AppointmentListItem): string {
  return appointment.title?.trim() || appointmentKindLabel[appointment.kind];
}

/** A segunda linha: com quem (empresa ou contato), ou o tipo quando o assunto já ocupou a primeira. */
export function appointmentSubline(appointment: AppointmentListItem): string | null {
  const who = appointment.customer
    ? customerDisplayName(appointment.customer)
    : appointment.contact?.name?.trim() || null;
  if (who) return who;
  return appointment.title?.trim() ? appointmentKindLabel[appointment.kind] : null;
}

/** Tudo o que o card resume, para o nome acessível e o `title`: a cor nunca é o único sinal. */
export function describeAppointment(appointment: AppointmentListItem): string {
  return [
    appointmentTimeRange(appointment),
    appointmentKindLabel[appointment.kind],
    appointment.title?.trim(),
    appointment.customer ? customerDisplayName(appointment.customer) : appointment.contact?.name?.trim(),
    appointment.assignee?.name,
    appointmentStatusLabel[appointment.status],
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * O card de um compromisso, o MESMO no mês, na semana e no dia (UI.md §5.15):
 * hora e assunto na 1ª linha, com quem na 2ª quando a altura deixa.
 *
 * ⚠️ **Opaco.** A paleta do sistema é translúcida (`tint` é /10): sobre a linha
 * da grade o texto sujava. Por isso o fundo é `bg-card` e a tinta do TIPO vem
 * por cima, com a barra lateral na cor dele. Cancelado risca o assunto;
 * realizado ganha o ✓ — a situação não depende só de cor.
 */
export function AgendaEvent({
  appointment,
  onOpen,
  twoLines = true,
  size = "compact",
  className,
}: {
  appointment: AppointmentListItem;
  onOpen: (appointment: AppointmentListItem) => void;
  /** Na grade, abaixo de `TWO_LINE_HEIGHT`, só cabe a 1ª linha. */
  twoLines?: boolean;
  /** `comfortable` = lista do dia no telefone: texto maior e alvo de toque de 44 px. */
  size?: "compact" | "comfortable";
  className?: string;
}) {
  const comfortable = size === "comfortable";
  const color = getColorStyle(appointmentKindColor[appointment.kind]);
  const cancelled = appointment.status === "cancelado";
  const subline = twoLines ? appointmentSubline(appointment) : null;
  const description = describeAppointment(appointment);

  return (
    <button
      type="button"
      onClick={() => onOpen(appointment)}
      aria-label={description}
      title={description}
      className={cn(
        "relative block w-full min-w-0 overflow-hidden rounded-md bg-card text-left outline-none ring-1 ring-inset ring-border/70 transition-[filter] hover:brightness-[0.97] focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110",
        className
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", color.bar)} />
      <span
        className={cn(
          "flex h-full min-w-0 flex-col overflow-hidden pl-2.5 pr-1.5",
          comfortable ? "py-2 pl-3.5" : "py-0.5",
          color.tint,
          cancelled && "opacity-60"
        )}
      >
        <span className="flex min-w-0 items-baseline gap-1">
          <span className={cn("shrink-0 font-semibold tabular-nums leading-tight", comfortable ? "text-sm" : "text-[11px]")}>
            {formatTime(appointment.scheduled_at)}
          </span>
          {appointment.status === "realizado" ? (
            <CheckIcon className="size-3 shrink-0 self-center text-muted-foreground" aria-hidden />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium leading-tight",
              comfortable ? "text-sm" : "text-[11px]",
              cancelled && "line-through"
            )}
          >
            {appointmentHeadline(appointment)}
          </span>
        </span>
        {subline ? (
          <span
            className={cn(
              "block truncate leading-tight text-muted-foreground",
              comfortable ? "mt-0.5 text-xs" : "text-[10px]"
            )}
          >
            {subline}
          </span>
        ) : null}
      </span>
    </button>
  );
}
