import { z } from "zod";

import { isGroupJid } from "@/features/chat/lib/whatsapp-group";

// Aviso à equipe quando a IA passa a conversa para um humano (handoff), pelo
// WhatsApp do CRM. Guardado em app_settings.key = 'handoff_alert'. Os dois
// canais são independentes: o que estiver preenchido recebe o aviso; os dois
// vazios = sem aviso.

/** Telefone do aviso: só dígitos, com o 55 (DDD + número ganha o 55). */
export function normalizeAlertNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

/** Telefone já normalizado: 55 + DDD + 8 ou 9 dígitos. */
export const ALERT_NUMBER_RE = /^55\d{10,11}$/;

export const handoffAlertSchema = z.object({
  number: z
    .string()
    .trim()
    .max(30, "Telefone inválido.")
    .transform(normalizeAlertNumber)
    .refine((value) => value === "" || ALERT_NUMBER_RE.test(value), {
      message: "Telefone inválido: use DDD + número (ex.: 86 99999-0000).",
    }),
  group_jid: z
    .string()
    .trim()
    .refine((value) => value === "" || isGroupJid(value), { message: "Grupo inválido." }),
  group_name: z.string().trim().max(120, "Nome do grupo longo demais.").default(""),
});

export type HandoffAlertInput = z.input<typeof handoffAlertSchema>;
