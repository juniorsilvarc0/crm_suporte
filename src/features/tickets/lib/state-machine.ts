import { TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import type { TicketStatusKey, TicketTransition } from "@/features/tickets/types";

// Para onde um ticket pode ir, lido da matriz do BANCO (ticket_status_transitions,
// que chega pelo catálogo). Não há matriz aqui: quem decide é a RPC
// ticket_transition, e a tela só deixa de oferecer o que ela recusaria. Sem o
// catálogo (`transitions: null`), nenhum destino é oferecido: a tela não
// inventa regra (AGENTS §0.2.5). Neutro: a rota, a query e o client importam.

/**
 * Destinos permitidos a partir de `from`, na ordem de `position` do status
 * (a mesma do `allowed` que a RPC devolve em INVALID_TRANSITION).
 */
export function allowedTargets(
  transitions: readonly TicketTransition[] | null,
  from: TicketStatusKey,
): TicketStatusKey[] {
  if (!transitions) return [];
  return TICKET_STATUS_KEYS.filter((to) =>
    transitions.some((pair) => pair.from_status === from && pair.to_status === to),
  );
}

export function canTransition(
  transitions: readonly TicketTransition[] | null,
  from: TicketStatusKey,
  to: TicketStatusKey,
): boolean {
  return (
    transitions?.some((pair) => pair.from_status === from && pair.to_status === to) ?? false
  );
}
