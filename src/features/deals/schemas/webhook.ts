import { z } from "zod";

// Payload de criação de um deal (card do funil) via API de integração.
// O lead é resolvido pelo telefone; a etapa (stage) é validada contra
// board_columns na rota (default 'novo').
export const dealWebhookSchema = z.object({
  phone: z.string().min(8),
  stage: z.string().min(1).optional(),
  tipo_ensaio: z.string().min(1).optional(),
  valor: z.number().nonnegative().optional(),
  scheduled_at: z.string().datetime().optional(),
  title: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
});

export type DealWebhookPayload = z.infer<typeof dealWebhookSchema>;
