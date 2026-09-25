import { appointmentStatusLabel } from "@/features/appointments/schemas/status";
import { getTipoEnsaioLabel } from "@/features/leads/schemas/status";
import type { Appointment } from "@/features/appointments/types";
import {
  dateKeyToAppDate,
  formatLongDate,
  formatMonthTitle,
  formatTime,
  toAppDate,
} from "@/lib/formatters/date";
import type { AppointmentStatus } from "@/lib/supabase/types";

export const weekDays = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

export const statusFilterOptions: Array<{ value: "" | AppointmentStatus; label: string }> = [
  { value: "", label: "Todos status" },
  { value: "agendado", label: "Agendado" },
  { value: "confirmado", label: "Confirmado" },
  { value: "compareceu", label: "Compareceu" },
  { value: "faltou", label: "Faltou" },
  { value: "cancelado", label: "Cancelado" },
];

/**
 * Opções do filtro de serviço, tiradas dos agendamentos em tela.
 *
 * ⚠️ **Não é mais a constante `tipoServicoOptions`.** O tipo de atendimento
 * virou catálogo do usuário: uma lista fixa no código passaria a oferecer
 * "Demonstração" e "Onboarding", que ninguém agenda, e a esconder os tipos que
 * a clínica realmente criou — filtro que nunca casa com nada.
 *
 * Derivar do que está na tela também é honesto com o que o filtro faz: ele
 * estreita a lista atual, então oferecer valor sem nenhum agendamento seria
 * prometer um resultado vazio.
 */
export function buildTipoFilterOptions(appointments: Appointment[]) {
  const seen = new Map<string, string>();
  for (const appointment of appointments) {
    const value = appointment.tipo_ensaio?.trim();
    if (!value || seen.has(value)) continue;
    seen.set(value, getTipoEnsaioLabel(value));
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export type AgendaView = "month" | "list" | "semana" | "dia";

export type AppointmentFilters = {
  status?: string;
  tipo?: string;
  q?: string;
};

export type DayGroup = {
  key: string;
  appointments: Appointment[];
  inCurrentMonth: boolean;
};

export function canMarkAppointmentAttended(status: AppointmentStatus) {
  return status !== "compareceu" && status !== "cancelado" && status !== "faltou";
}

/**
 * Escolhe o ponto de entrada da lista mobile sem obrigar a percorrer o mês:
 * hoje, o próximo dia com evento ou, se o mês já passou, o evento mais recente.
 */
export function resolveInitialAppointmentDayKey(
  days: ReadonlyArray<Pick<DayGroup, "key">>,
  todayKey: string
) {
  const keys = days.map((day) => day.key).sort();
  return keys.find((key) => key >= todayKey) ?? keys.at(-1) ?? "";
}

export function buildAgendaHref({
  monthKey,
  dateKey,
  view,
  filters,
}: {
  monthKey?: string;
  dateKey?: string;
  view: AgendaView;
  filters?: AppointmentFilters;
}) {
  const params = new URLSearchParams();
  params.set("view", view);
  if ((view === "semana" || view === "dia") && dateKey) {
    params.set("date", dateKey);
  } else if (monthKey) {
    params.set("month", monthKey);
  }

  const status = filters?.status?.trim();
  const tipo = filters?.tipo?.trim();
  const query = filters?.q?.trim();

  if (status) params.set("status", status);
  if (tipo) params.set("tipo", tipo);
  if (query) params.set("q", query);

  return `/app/agendamentos?${params.toString()}`;
}

export function matchesAppointmentFilters(appointment: Appointment, filters: AppointmentFilters) {
  const status = filters.status?.trim();
  const tipo = filters.tipo?.trim();
  const query = normalizeSearch(filters.q);

  if (status && appointment.status !== status) return false;
  if (tipo && appointment.tipo_ensaio !== tipo) return false;
  if (!query) return true;

  const haystack = normalizeSearch(
    [
      appointment.leads?.name,
      appointment.leads?.phone,
      appointment.tipo_ensaio,
      formatTipoEnsaio(appointment.tipo_ensaio),
      appointment.status,
      appointmentStatusLabel[appointment.status],
      appointment.notes,
      appointment.google_event_id ? "google agenda" : "manual crm",
    ]
      .filter(Boolean)
      .join(" ")
  );

  return haystack.includes(query);
}

function normalizeSearch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function formatDisplayMonthTitle(monthKey: string) {
  return capitalizeFirst(formatMonthTitle(monthKey));
}

export function formatWeekdayLong(dateKey: string) {
  const date = dateKeyToAppDate(dateKey);
  return date ? formatLongDate(date) : dateKey;
}

export function capitalizeFirst(value: string) {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

export function appointmentStatusClass(status: AppointmentStatus) {
  if (status === "compareceu") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "confirmado" || status === "agendado") {
    return "border-primary/30 bg-primary/10 text-primary";
  }
  if (status === "cancelado" || status === "faltou") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted text-foreground";
}

/**
 * Cor do card de agendamento no calendário — mês, semana e dia.
 *
 * ⚠️ **Opaca, sempre.** A grade de horários usava uma escala `/10` própria, 90%
 * transparente: dois agendamentos que se cruzavam deixavam o texto de baixo
 * atravessar o card de cima. Mesmo com faixas lado a lado, fundo translúcido
 * sobre a linha da grade continua sujando a leitura.
 *
 * ⚠️ **Sem `google_event_id` é âmbar**, e isso vem antes do caso geral: é o
 * agendamento criado à mão no CRM, que não existe no Google Agenda. A grade
 * ignorava esse caso e pintava tudo de roxo — a mesma consulta trocava de cor
 * ao alternar entre mês e semana.
 */
export function appointmentToneClass(appointment: Appointment) {
  if (appointment.status === "compareceu") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100";
  }
  if (appointment.status === "cancelado" || appointment.status === "faltou") {
    return "bg-destructive/10 text-destructive";
  }
  if (appointment.status === "confirmado") {
    return "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-100";
  }
  if (!appointment.google_event_id) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-100";
  }
  return "bg-primary/10 text-primary";
}

export function appointmentDotClass(status: AppointmentStatus) {
  if (status === "compareceu") return "bg-emerald-500";
  if (status === "confirmado" || status === "agendado") return "bg-primary";
  if (status === "cancelado" || status === "faltou") return "bg-destructive";
  return "bg-muted-foreground/60";
}

export function compareAppointments(a: Appointment, b: Appointment) {
  return (
    (toAppDate(a.scheduled_at)?.getTime() ?? 0) -
    (toAppDate(b.scheduled_at)?.getTime() ?? 0)
  );
}

export function getEndTime(appointment: Appointment) {
  const start = toAppDate(appointment.scheduled_at);
  if (!start || !appointment.duration_min) return "";

  const end = new Date(start.getTime() + appointment.duration_min * 60_000);
  return formatTime(end.toISOString());
}

export function extractNoteLine(notes: string | null, label: string) {
  if (!notes) return "";

  const prefix = `${label}:`;
  const line = notes
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(prefix.toLowerCase()));

  return line ? line.slice(prefix.length).trim() : "";
}

export function formatTipoEnsaio(value: string | null) {
  return value ? getTipoEnsaioLabel(value) : "Serviço a definir";
}

/** Opções de duração, iguais em criar e editar. */
export const durationOptions = [
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hora" },
  { value: "90", label: "1h30" },
  { value: "120", label: "2 horas" },
];
