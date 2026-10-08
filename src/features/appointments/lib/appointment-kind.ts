import type { ColorName } from "@/features/tags/schemas/colors";

// O tipo de um compromisso da agenda do suporte. A clínica tinha uma tabela
// configurável (appointment_types); aqui é um ENUM FIXO, com rótulo e cor por
// tipo — no molde de isTicketStatus/isSlaMode. Espelha o check da coluna
// `appointments.kind` (migration 20261008160000).

export const APPOINTMENT_KINDS = [
  "visita_tecnica",
  "treinamento",
  "implantacao",
  "acesso_remoto",
] as const;

export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export function isAppointmentKind(value: unknown): value is AppointmentKind {
  return typeof value === "string" && (APPOINTMENT_KINDS as readonly string[]).includes(value);
}

export const appointmentKindLabel: Record<AppointmentKind, string> = {
  visita_tecnica: "Visita técnica",
  treinamento: "Treinamento",
  implantacao: "Implantação",
  acesso_remoto: "Acesso remoto",
};

// Cor por tipo, pelo sistema de 19 cores nomeadas (UI.md §cores): a UI consome
// com getColorStyle(appointmentKindColor[kind]).badge — nada de hex no componente.
export const appointmentKindColor: Record<AppointmentKind, ColorName> = {
  visita_tecnica: "sky",
  treinamento: "violet",
  implantacao: "emerald",
  acesso_remoto: "amber",
};

/** Para o FormSelect de tipo. */
export const appointmentKindOptions = APPOINTMENT_KINDS.map((kind) => ({
  value: kind,
  label: appointmentKindLabel[kind],
}));
