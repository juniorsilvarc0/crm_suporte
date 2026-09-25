import { z } from "zod";

import type { Json } from "@/lib/supabase/types";

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ])
);

export const leadWebhookSchema = z.object({
  phone: z.string().min(8),
  name: z.string().min(1).optional(),
  instagram_user: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  source: z
    .enum(["agencia", "anuncio", "particular", "indicacao", "whatsapp", "importado", "outro"])
    .optional(),
  status: z
    .enum([
      "novo",
      "em_atendimento",
      "qualificado",
      "agendado",
      "compareceu",
      "cliente",
      "recorrente",
      "perdido",
    ])
    .optional(),
  tipo_ensaio: z.string().min(1).optional(),
  agencia_nome: z.string().min(1).optional(),
  modelo_nome: z.string().min(1).optional(),
  interesse: z.string().min(1).optional(),
  valor_estimado: z.number().nonnegative().optional(),
  is_recorrente: z.boolean().optional(),
  memoria_contexto: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

export type LeadWebhookPayload = z.infer<typeof leadWebhookSchema>;
