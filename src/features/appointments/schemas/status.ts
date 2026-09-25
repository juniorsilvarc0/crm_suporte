import type { AppointmentStatus } from "@/lib/supabase/types";

export const appointmentStatusLabel: Record<AppointmentStatus, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  compareceu: "Compareceu",
  faltou: "Faltou",
  cancelado: "Cancelado",
};
