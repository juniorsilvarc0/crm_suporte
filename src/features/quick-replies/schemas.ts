import { z } from "zod";

const shortcutSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/+/, "").toLocaleLowerCase("pt-BR"))
  .pipe(
    z
      .string()
      .min(1, "Informe um atalho.")
      .max(40, "Máximo de 40 caracteres.")
      .regex(
        /^[a-z0-9_-]+$/,
        "Use somente letras sem acento, números, hífen ou sublinhado.",
      ),
  );

const quickReplyFields = {
  title: z
    .string()
    .trim()
    .min(1, "Informe um título.")
    .max(80, "Máximo de 80 caracteres."),
  shortcut: shortcutSchema,
  content: z
    .string()
    .trim()
    .min(1, "Informe a mensagem.")
    .max(4000, "Máximo de 4.000 caracteres."),
  is_active: z.boolean(),
};

export const quickReplyInputSchema = z.object({
  ...quickReplyFields,
  is_active: quickReplyFields.is_active.default(true),
});

export const quickReplyUpdateSchema = z.object(quickReplyFields).partial().refine(
  (value) => Object.keys(value).length > 0,
  "Informe ao menos um campo para atualizar.",
);

export type QuickReplyInput = z.infer<typeof quickReplyInputSchema>;
