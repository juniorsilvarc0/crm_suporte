import { z } from "zod";

import {
  ENVIRONMENT_VARIABLE_NAME_PATTERN,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  RELAY_SIGNING_SECRET_NAME,
  RUNTIME_ENVIRONMENT_NAMES,
} from "@/features/settings/types";

const modelNames = new Set<string>(
  OPENAI_TRANSCRIPTION_MODELS.map((model) => model.value)
);

// O Cofre só guarda o catálogo (o que o app de fato lê). A chave de assinatura
// do relay está no catálogo, mas não se grava à mão: o CRM a gera e a mostra
// uma vez (/api/connection/agent/signing-secret).
const catalogNames = new Set<string>(RUNTIME_ENVIRONMENT_NAMES);
const editableNames = RUNTIME_ENVIRONMENT_NAMES.filter((name) => name !== RELAY_SIGNING_SECRET_NAME);
const GENERATED_BY_CRM = "A chave de assinatura é gerada pelo CRM, em Agente de IA.";

export const environmentVariableSchema = z
  .object({
    name: z
      .string({ error: "Informe a chave da variável." })
      .trim()
      .transform((value) => value.toUpperCase())
      .refine(
        (value) => catalogNames.has(value),
        `O cofre só guarda as chaves que o CRM usa: ${editableNames.join(", ")}.`
      )
      .refine((value) => value !== RELAY_SIGNING_SECRET_NAME, GENERATED_BY_CRM),
    value: z
      .string({ error: "Informe o valor da variável." })
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

// Apagar segue aceitando qualquer nome bem formado: é como se limpa uma
// variável antiga, de antes do catálogo. Só a chave de assinatura fica de fora
// (ela sai pela rota do agente, que avisa o que muda no repasse).
export const deleteEnvironmentVariableSchema = z.object({
  name: z
    .string({ error: "Variável inválida." })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => ENVIRONMENT_VARIABLE_NAME_PATTERN.test(value),
      "Variável inválida."
    )
    .refine((value) => value !== RELAY_SIGNING_SECRET_NAME, GENERATED_BY_CRM),
});
