import { z } from "zod";

import { jsonSchema } from "@/features/leads/schemas/webhook";

export const followupWebhookSchema = z.object({
  phone: z.string().min(8),
  step: z.string().min(1),
  reason: z.string().min(1).optional(),
  message: z.string().optional(),
  sent_at: z.string().datetime().optional(),
  replied: z.boolean().default(false),
  replied_at: z.string().datetime().optional(),
  recovered: z.boolean().default(false),
  payload: jsonSchema.default({}),
  idempotency_key: z.string().min(1).optional(),
});

export type FollowupWebhookPayload = z.infer<typeof followupWebhookSchema>;
