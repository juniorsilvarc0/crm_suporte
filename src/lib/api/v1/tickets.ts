import { z } from "zod";

import { getSlaState } from "@/features/tickets/lib/sla";
import { TICKET_PRIORITIES } from "@/features/tickets/lib/ticket-priority";
import { TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import type { TicketListItem, TicketSource } from "@/features/tickets/types";

// Ticket da API v1, como o /context o entrega (e a base do recurso de tickets).
// Campo a campo, em snake_case: sem cor, foto nem texto de selo, que são da
// tela. O SLA sai calculado pela MESMA regra da view ticket_queue (lib/sla.ts).

const TICKET_SOURCES = ["ai", "agent", "api"] as const satisfies readonly TicketSource[];

const ref = z.strictObject({ id: z.string(), name: z.string() });

export const ticketSchema = z.strictObject({
  id: z.string(),
  /** O protocolo que o cliente vê. */
  number: z.number().int(),
  title: z.string(),
  status: z.enum(TICKET_STATUS_KEYS),
  priority: z.enum(TICKET_PRIORITIES),
  source: z.enum(TICKET_SOURCES).describe("Quem abriu: agent (tela), ai ou api."),
  version: z.number().int().describe("Sobe a cada alteração do ticket (concorrência otimista)."),
  conversation_id: z.string(),
  is_terminal: z.boolean().describe("Fechado ou cancelado: não muda mais de status."),
  product: ref.nullable(),
  assignee: ref.nullable(),
  sla: z.strictObject({
    breached: z
      .boolean()
      .describe(
        "Vencido AGORA (a regra do filtro sla_breached): 1ª resposta pendente depois do prazo, ou solução vencida " +
          "com o relógio correndo ou pausado fora do prazo. Resolvido, fechado ou cancelado é sempre false. " +
          "Calculado no instante da resposta."
      ),
    at_risk: z
      .boolean()
      .describe("Nada vencido, mas já passou do percentual de aviso. Sempre false com o relógio parado."),
    next_due_at: z.string().nullable().describe("O próximo prazo correndo; null = relógio parado."),
    first_response_due_at: z.string(),
    resolution_due_at: z.string(),
    first_responded_at: z.string().nullable(),
  }),
  resolved_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ApiTicket = z.infer<typeof ticketSchema>;

export function toApiTicket(ticket: TicketListItem, now: Date): ApiTicket {
  const sla = getSlaState(ticket, now);
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    version: ticket.version,
    conversation_id: ticket.conversation_id,
    is_terminal: ticket.is_terminal,
    product: ticket.product ? { id: ticket.product.id, name: ticket.product.name } : null,
    assignee: ticket.assignee ? { id: ticket.assignee.id, name: ticket.assignee.name } : null,
    sla: {
      breached: sla.breached,
      at_risk: sla.atRisk,
      next_due_at: sla.nextDueAt,
      first_response_due_at: ticket.first_response_due_at,
      resolution_due_at: ticket.resolution_due_at,
      first_responded_at: ticket.first_responded_at,
    },
    resolved_at: ticket.resolved_at,
    closed_at: ticket.closed_at,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
}
