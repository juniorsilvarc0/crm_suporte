import { z } from "zod";

import { localDateTimeToIso } from "@/lib/formatters/date";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const scheduledFor = z
  .string()
  .min(1, "Informe data e hora.")
  .refine((value) => localDateTimeToIso(value) !== "", "Data inválida.");

export const createFollowupSchema = z.object({
  lead_id: z.string().uuid("Selecione um lead válido."),
  scheduled_for: scheduledFor,
  message: optionalText,
});

export const updateFollowupSchema = z
  .object({
    scheduled_for: scheduledFor.optional(),
    message: optionalText,
    status: z.enum(["pendente", "enviado", "cancelado"]).optional(),
  })
  .refine(
    (value) =>
      value.scheduled_for !== undefined ||
      value.message !== undefined ||
      value.status !== undefined,
    { message: "Nada para atualizar." }
  );

export type CreateFollowupInput = z.infer<typeof createFollowupSchema>;
export type UpdateFollowupInput = z.infer<typeof updateFollowupSchema>;
