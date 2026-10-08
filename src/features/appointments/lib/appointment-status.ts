import type { ColorName } from "@/features/tags/schemas/colors";

// O estado de um compromisso. A clínica tinha `compareceu`/`faltou` (presença);
// aqui o fluxo é agendado → confirmado → realizado, ou cancelado. Espelha o
// check da coluna `appointments.status` (migration 20261008160000).

export const APPOINTMENT_STATUSES = ["agendado", "confirmado", "realizado", "cancelado"] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === "string" && (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}

export const appointmentStatusLabel: Record<AppointmentStatus, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  realizado: "Realizado",
  cancelado: "Cancelado",
};

// Cor por estado, pelo sistema de 19 cores nomeadas (UI.md diz que a agenda
// colore por status): realizado=verde, confirmado=azul, agendado=neutro,
// cancelado=destaque. A UI consome com getColorStyle(...).badge.
export const appointmentStatusColor: Record<AppointmentStatus, ColorName> = {
  agendado: "slate",
  confirmado: "blue",
  realizado: "emerald",
  cancelado: "rose",
};

/** Para o FormSelect de estado. */
export const appointmentStatusOptions = APPOINTMENT_STATUSES.map((status) => ({
  value: status,
  label: appointmentStatusLabel[status],
}));
