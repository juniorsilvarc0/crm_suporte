import { z } from "zod";

// Assinatura das mensagens respondidas pela IA/agente. Guardada no CRM
// (app_settings.key = 'bot_signature'); quem aplica o prefixo é o agente (o CRM
// não envia as mensagens do bot). Regra do produto: se ligada, o apelido é
// OBRIGATÓRIO — não dá para assinar sem um nome.
export const botSignatureSchema = z
  .object({
    enabled: z.boolean(),
    apelido: z.string().trim().max(40, "Máximo de 40 caracteres."),
  })
  .refine((v) => !v.enabled || v.apelido.length > 0, {
    message: "Defina um apelido para assinar as mensagens do bot.",
    path: ["apelido"],
  });

export type BotSignatureInput = z.infer<typeof botSignatureSchema>;
