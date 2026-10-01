import { z } from "zod";

import {
  ENVIRONMENT_VARIABLE_NAME_PATTERN,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  RELAY_SIGNING_SECRET_NAME,
} from "@/features/settings/types";

const modelNames = new Set<string>(
  OPENAI_TRANSCRIPTION_MODELS.map((model) => model.value)
);

// A chave que assina os repasses ao agente (docs/CONTRATO-RELAY.md). Curta, sai
// por força bruta a partir de UM pedido capturado; com espaço ou quebra de
// linha colada no fim, o agente recusa tudo sem que ninguém veja por quê.
const SIGNING_SECRET_PATTERN = /^\S{32,}$/;

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
    if (
      value.name === RELAY_SIGNING_SECRET_NAME &&
      !SIGNING_SECRET_PATTERN.test(value.value)
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message:
          "A chave de assinatura precisa de 32 caracteres ou mais, sem espaços. Gere com: openssl rand -hex 32",
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
