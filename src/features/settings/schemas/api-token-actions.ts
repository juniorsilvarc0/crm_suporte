import { z } from "zod";

export const createApiTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe um nome.")
    .max(60, "Máximo de 60 caracteres."),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
