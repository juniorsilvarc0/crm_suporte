import { z } from "zod";

import { APPOINTMENT_KINDS } from "@/features/appointments/lib/appointment-kind";
import { APPOINTMENT_STATUSES } from "@/features/appointments/lib/appointment-status";
import { localDateTimeToIso } from "@/lib/formatters/date";

// Compartilhado entre o dialog (react-hook-form + zodResolver) e as rotas: a
// mesma regra vale nos dois lados; o banco confere de novo o que é dele (checks
// de kind/status/duração e as FKs). O `created_by_user_id` NÃO entra aqui — é o
// servidor que o preenche com o usuário da sessão.

// Texto em branco (ou só espaços) = "sem valor" → null (o banco recusa branco
// nos checks de tamanho mas aceita null). Ausente continua ausente.
function blankToNull(value: string | null): string | null {
  return value ? value : null;
}

const title = z
  .string("Título inválido.")
  .trim()
  .max(200, "Máximo de 200 caracteres.")
  .nullable()
  .transform(blankToNull);

const location = z
  .string("Local inválido.")
  .trim()
  .max(300, "Máximo de 300 caracteres.")
  .nullable()
  .transform(blankToNull);

const notes = z
  .string("Observações inválidas.")
  .trim()
  .max(5000, "Observações muito longas.")
  .nullable()
  .transform(blankToNull);

// O dialog manda "AAAA-MM-DDTHH:MM" (DateTimeFields); converte para ISO. Vazio
// ou inválido reprova. Igual ao legado.
const scheduledAt = z
  .string("Informe a data e a hora.")
  .refine((value) => localDateTimeToIso(value) !== "", "Data e hora inválidas.")
  .transform((value) => localDateTimeToIso(value));

// Vínculo opcional: "" (campo não preenchido) vira ausente, não erro de uuid.
const optionalUuid = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.uuid("Identificador inválido.").optional()
);

const appointmentFields = {
  kind: z.enum(APPOINTMENT_KINDS),
  scheduled_at: scheduledAt,
  title: title.optional(),
  duration_min: z.coerce.number().int().positive().max(1440).optional(),
  location: location.optional(),
  // Sem default aqui: no CREATE, ausente cai no default do banco ('agendado');
  // no UPDATE (partial), ausente = não mexe.
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  notes: notes.optional(),
  ticket_id: optionalUuid,
  customer_id: optionalUuid,
  contact_id: optionalUuid,
  assignee_id: optionalUuid,
};

export const appointmentCreateSchema = z.object(appointmentFields).strict();

export const appointmentUpdateSchema = z
  .object(appointmentFields)
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Nada para atualizar.");

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;
export type AppointmentUpdateInput = z.infer<typeof appointmentUpdateSchema>;
