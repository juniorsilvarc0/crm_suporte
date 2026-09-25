import { z } from "zod";

import {
  ENVIRONMENT_VARIABLE_NAME_PATTERN,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
} from "@/features/settings/types";

const modelNames = new Set<string>(
  OPENAI_TRANSCRIPTION_MODELS.map((model) => model.value)
);

export const environmentVariableSchema = z
  .object({
    name: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine(
        (value) => ENVIRONMENT_VARIABLE_NAME_PATTERN.test(value),
        "Use letras maiúsculas, números e sublinhado. Comece por uma letra."
      ),
    value: z
      .string()
      .min(1, "Informe o valor da variável.")
      .max(16_384, "O valor deve ter no máximo 16 KB."),
    replace: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (
      value.name === OPENAI_TRANSCRIPTION_MODEL_NAME &&
      !modelNames.has(value.value)
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Selecione um modelo de transcrição compatível.",
      });
    }
  });

export const deleteEnvironmentVariableSchema = z.object({
  name: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => ENVIRONMENT_VARIABLE_NAME_PATTERN.test(value),
      "Variável inválida."
    ),
});
