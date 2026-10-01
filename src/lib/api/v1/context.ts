import { z } from "zod";

import type { ContractView } from "@/features/contracts/types";
import { contactSchema, contractSchema, customerSchema, phoneLookup } from "@/lib/api/v1/cadastros";
import { conversationSchema, messageSchema } from "@/lib/api/v1/conversations";
import { ticketSchema } from "@/lib/api/v1/tickets";

// GET /api/v1/context?phone= (PR 7 do docs/PLANO-FASE-5.md, decisão D11): tudo
// o que a IA precisa para triar numa ida só. O relay v1 (PR 11) manda um
// recorte disto (contato, empresa, resumo do contrato e ticket em foco), nos
// mesmos formatos, montado por features/integrations/server/relay-envelope.ts.

export const CONTRACT_ALERTS = ["sem_empresa", "sem_contrato", "suspenso", "encerrado"] as const;
export type ContractAlert = (typeof CONTRACT_ALERTS)[number];

export const openTicketSchema = ticketSchema.extend({
  allowed_transitions: z
    .array(ticketSchema.shape.status)
    .nullable()
    .describe("Para onde o status pode ir agora. null = a matriz está indisponível no momento (nunca 'nenhum')."),
});

export const triageContextSchema = z.strictObject({
  contact: contactSchema.nullable().describe("null = telefone desconhecido (o GET nunca cria contato)."),
  customer: customerSchema.nullable(),
  contract: contractSchema.nullable().describe("O contrato atual (a regra do selo), sem valor nem dia de vencimento."),
  contract_alert: z
    .enum(CONTRACT_ALERTS)
    .nullable()
    .describe("null = contrato ativo. Senão, o motivo do alerta: sem_empresa, sem_contrato, suspenso ou encerrado."),
  conversation: conversationSchema.nullable().describe("A conversa mais recente do contato."),
  open_tickets: z
    .array(openTicketSchema)
    .describe(
      "Os tickets não terminais da conversa, na ordem do prazo, até 20. O ticket em foco entra sempre, mesmo além do corte."
    ),
  open_tickets_truncated: z
    .boolean()
    .describe("true = a conversa tem mais tickets não terminais do que os de open_tickets."),
  recent_tickets: z
    .array(ticketSchema)
    .describe(
      "Os últimos 5 tickets encerrados do contato (fechados ou cancelados), do mais recente. O bloco `sla` deles " +
        "vem sempre sem prazo correndo: não diz se o atendimento ficou no prazo."
    ),
  messages: z
    .array(messageSchema)
    .describe("As últimas mensagens da conversa, da mais antiga para a mais nova. Sem as notas internas."),
  ai_may_reply: z.boolean().describe("true só com a conversa em `bot`. Com um analista (`human`), a IA não responde."),
});

export type TriageContext = z.infer<typeof triageContextSchema>;

export const contextQuerySchema = z.strictObject({ phone: phoneLookup });

/** D11: alerta quando não há empresa, não há contrato, ou ele não está ativo. */
export function contractAlert(hasCustomer: boolean, contract: ContractView | null): ContractAlert | null {
  if (!hasCustomer) return "sem_empresa";
  if (!contract) return "sem_contrato";
  return contract.status === "ativo" ? null : contract.status;
}
