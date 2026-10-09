import { z } from "zod";

import { WEBHOOK_EVENTS } from "@/features/webhooks/catalog";

// Compartilhado entre as rotas e o formulário da tela. A URL passa ainda pela
// guarda de SSRF na rota (HTTPS em produção, sem endereço interno).

const name = z
  .string("Informe o nome.")
  .trim()
  .min(1, "Informe o nome.")
  .max(80, "Máximo de 80 caracteres.");

const url = z
  .string("Informe a URL.")
  .trim()
  .min(1, "Informe a URL.")
  .max(2000, "URL longa demais.");

const events = z
  .array(z.enum(WEBHOOK_EVENTS), "Escolha os eventos.")
  .min(1, "Escolha ao menos um evento.")
  .max(WEBHOOK_EVENTS.length)
  // Repetido não quebra nada, mas também não diz nada: sai deduplicado.
  .transform((list) => [...new Set(list)]);

export const webhookCreateSchema = z.object({ name, url, events }).strict();

export const webhookUpdateSchema = z
  .object({ name, url, events, is_active: z.boolean() })
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Nada para atualizar.");

export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;
