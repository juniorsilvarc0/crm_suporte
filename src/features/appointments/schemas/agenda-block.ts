import { z } from "zod";

import { localToIso } from "@/features/appointments/lib/agenda-blocks";
import { addDaysToAppDateKey, localDateTimeToIso, toAppDateKey } from "@/lib/formatters/date";

// Cadastro de bloqueio, compartilhado entre o diálogo e a rota. Duas formas:
// - dia inteiro: `start_date`/`end_date` (o fim é o ÚLTIMO dia, inclusive); vira
//   00:00 do primeiro dia até 00:00 do dia SEGUINTE ao último (fim exclusivo —
//   senão o último minuto do dia ficaria livre);
// - intervalo: `starts_at`/`ends_at` em "AAAA-MM-DDTHH:MM" (DateTimeFields).
// A rota recebe tudo em ISO; o banco confere de novo `ends_at > starts_at`.

function blankToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

const reason = z
  .string("Motivo inválido.")
  .trim()
  .max(300, "Máximo de 300 caracteres.")
  .nullable()
  .optional()
  .transform(blankToNull);

// "" (sem técnico) = bloqueio de todos.
const assigneeId = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.uuid("Técnico inválido.").optional()
);

// Dia que existe de verdade: "2026-02-31" não passa (a volta não bate).
const dateKey = z
  .string("Informe a data.")
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && toAppDateKey(localToIso(value, "12:00")) === value, "Data inválida.");

const localDateTime = z
  .string("Informe a data e a hora.")
  .refine((value) => localDateTimeToIso(value) !== "", "Data e hora inválidas.");

const allDayBlock = z
  .object({
    all_day: z.literal(true),
    start_date: dateKey,
    end_date: dateKey,
    reason,
    assignee_id: assigneeId,
  })
  .strict()
  .refine((value) => value.end_date >= value.start_date, {
    message: "O último dia não pode ser antes do primeiro.",
    path: ["end_date"],
  });

const partialBlock = z
  .object({
    all_day: z.literal(false),
    starts_at: localDateTime,
    ends_at: localDateTime,
    reason,
    assignee_id: assigneeId,
  })
  .strict()
  .refine((value) => Date.parse(localDateTimeToIso(value.ends_at)) > Date.parse(localDateTimeToIso(value.starts_at)), {
    message: "O fim precisa ser depois do começo.",
    path: ["ends_at"],
  });

export const agendaBlockCreateSchema = z.discriminatedUnion("all_day", [allDayBlock, partialBlock]).transform((value) => ({
  all_day: value.all_day,
  starts_at: value.all_day ? localToIso(value.start_date, "00:00") : localDateTimeToIso(value.starts_at),
  ends_at: value.all_day
    ? localToIso(addDaysToAppDateKey(value.end_date, 1), "00:00")
    : localDateTimeToIso(value.ends_at),
  reason: value.reason,
  assignee_id: value.assignee_id,
}));

export type AgendaBlockCreateInput = z.input<typeof agendaBlockCreateSchema>;
export type AgendaBlockCreateRow = z.output<typeof agendaBlockCreateSchema>;
