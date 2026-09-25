import { z } from "zod";

export const appointmentWebhookSchema = z.object({
  phone: z.string().min(8),
  scheduled_at: z.string().datetime(),
  tipo_ensaio: z.string().min(1).optional(),
  duration_min: z.number().int().positive().optional(),
  notes: z.string().min(1).optional(),
  status: z
    .enum(["agendado", "confirmado", "compareceu", "faltou", "cancelado"])
    .default("agendado"),
  idempotency_key: z.string().min(1).optional(),
});

export type AppointmentWebhookPayload = z.infer<typeof appointmentWebhookSchema>;
