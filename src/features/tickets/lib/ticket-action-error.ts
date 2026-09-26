import { invalidTransitionMessage } from "@/features/tickets/lib/ticket-actions";
import { ticketFieldError, type TicketRequestFailure } from "@/features/tickets/lib/ticket-request";
import type { TicketStatusKey, TicketStatusOption } from "@/features/tickets/types";

// O texto do toast de uma ação de ticket recusada fora do detalhe (a lista, o
// painel do contato no chat e o Início): lá o detalhe tem alerta no topo e
// mensagem própria (useTicketMutation). Neutro: o client importa.

const CONFLICT_MESSAGE = "O ticket mudou em outro lugar.";
const TAKEN_MESSAGE = "Alguém já pegou este ticket.";
const FAILURE_MESSAGE = "Não foi possível concluir a operação.";
const NETWORK_MESSAGE = "Não foi possível concluir a operação. Confira a conexão e tente de novo.";

/**
 * Conflito de versão e ticket já pego têm frase própria (quem chama relê em
 * seguida); transição fora da matriz lista os destinos com os rótulos do
 * catálogo. O resto usa o erro do campo ou o que a rota disse.
 */
export function ticketActionErrorMessage(
  result: TicketRequestFailure,
  fromStatus: TicketStatusKey,
  statuses: readonly TicketStatusOption[] | null
): string {
  if (result.status === 0) return NETWORK_MESSAGE;
  const payload = result.body;
  switch (payload?.code) {
    case "version_conflict":
      return CONFLICT_MESSAGE;
    case "already_assigned":
      return TAKEN_MESSAGE;
    case "invalid_transition":
      return invalidTransitionMessage(
        { message: payload.message ?? FAILURE_MESSAGE, allowed: payload.allowed, current: payload.current },
        fromStatus,
        statuses
      );
  }
  return ticketFieldError(payload) ?? payload?.message ?? FAILURE_MESSAGE;
}
