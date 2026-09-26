// Prioridade do ticket (check sla_policies_priority_check), da menor para a
// maior, como o `rank` do banco. O rótulo é fixo; minutos de SLA e aviso são do
// admin e vêm do catálogo (sla_policies). Neutro: rota, query e client importam.
export const TICKET_PRIORITIES = ["baixa", "media", "alta", "critica"] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

// `Object.hasOwn`, não `in`: o valor vem do banco, da URL ou do corpo.
export function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === "string" && Object.hasOwn(TICKET_PRIORITY_LABEL, value);
}
