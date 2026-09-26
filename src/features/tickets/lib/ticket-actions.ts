import { canTransition } from "@/features/tickets/lib/state-machine";
import { TICKET_STATUS_FALLBACK_LABEL } from "@/features/tickets/lib/ticket-status";
import type {
  TicketErrorBody,
  TicketListItem,
  TicketStatusKey,
  TicketStatusOption,
  TicketTransition,
} from "@/features/tickets/types";

// Ações rápidas do ticket (detalhe, chip do chat, painel do contato e Início) e
// o texto do toast de transição inválida. Como lib/state-machine.ts, não decide
// nada: só deixa de oferecer o que a RPC recusaria. Sem o catálogo
// (`transitions: null`), nenhuma transição é oferecida. Neutro: o client importa.

export type TicketQuickActionId = "take_over" | "await_customer" | "resolve" | "reopen" | "close";

// `take_over` → POST /api/tickets/[id]/take-over; `transition` → POST
// /api/tickets/[id]/transition com `{ to, version }`.
export type TicketQuickAction =
  | { id: "take_over"; kind: "take_over"; label: string }
  | {
      id: Exclude<TicketQuickActionId, "take_over">;
      kind: "transition";
      to: TicketStatusKey;
      label: string;
    };

type QuickActionTicket = Pick<TicketListItem, "status" | "sla_mode"> & {
  assignee: { id: string } | null;
};

// Quem o ticket_apply_take_over leva a em_atendimento (migration 20260925120900,
// 7.6). Nos outros status o "Assumir" só atribui e põe a conversa em humano.
const TAKE_OVER_MOVES_FROM: readonly TicketStatusKey[] = ["novo", "em_triagem"];

const TRANSITION_ACTIONS: ReadonlyArray<{
  id: Exclude<TicketQuickActionId, "take_over">;
  to: TicketStatusKey;
  label: string;
}> = [
  { id: "await_customer", to: "aguardando_cliente", label: "Aguardar cliente" },
  { id: "resolve", to: "resolvido", label: "Resolver" },
  { id: "reopen", to: "em_atendimento", label: "Reabrir" },
  { id: "close", to: "fechado", label: "Fechar" },
];

/**
 * As ações rápidas que cabem no ticket agora, na ordem da spec: Atender,
 * Aguardar cliente, Resolver, Reabrir, Fechar. Cada transição só aparece se o
 * destino estiver em `allowedTargets` da matriz do banco.
 *
 * - **Atender** (take-over): relógio não parado (resolvido se reabre, não se
 *   atende) e ticket sem responsável ou já do próprio analista. Tomar o ticket
 *   de outro é o "Atribuir" do menu ou o diálogo do "Assumir" do chat. De novo
 *   ou em triagem, o take-over move para em_atendimento: aí também exige a
 *   aresta na matriz; nos outros status, some quando o ticket já é do analista
 *   (não mudaria nada).
 * - **Reabrir** é a volta a em_atendimento de um status com o relógio parado
 *   (resolvido). A volta de aguardando_* não é ação rápida: a retomada por
 *   mensagem do cliente já faz.
 */
export function quickActions(
  ticket: QuickActionTicket,
  transitions: readonly TicketTransition[] | null,
  viewerId: string
): TicketQuickAction[] {
  const actions: TicketQuickAction[] = [];
  const stopped = ticket.sla_mode === "stopped";
  const assigneeId = ticket.assignee?.id ?? null;

  if (!stopped && (assigneeId === null || assigneeId === viewerId)) {
    const moves = TAKE_OVER_MOVES_FROM.includes(ticket.status);
    const offer = moves
      ? canTransition(transitions, ticket.status, "em_atendimento")
      : assigneeId === null;
    if (offer) actions.push({ id: "take_over", kind: "take_over", label: "Atender" });
  }

  for (const action of TRANSITION_ACTIONS) {
    if (action.id === "reopen" && !stopped) continue;
    if (!canTransition(transitions, ticket.status, action.to)) continue;
    actions.push({ ...action, kind: "transition" });
  }

  return actions;
}

type StatusLabels = readonly Pick<TicketStatusOption, "key" | "label">[] | null;

/** Rótulo do status pelo catálogo (o do admin); sem ele, o de recurso. */
export function ticketStatusLabel(key: TicketStatusKey, statuses: StatusLabels): string {
  const label = statuses?.find((status) => status.key === key)?.label.trim();
  return label || TICKET_STATUS_FALLBACK_LABEL[key];
}

/**
 * Texto do toast do 409 `invalid_transition`: "De Novo só vai para Em triagem,
 * Cancelado." com os rótulos do catálogo. `current` do corpo vence o status que
 * a tela tinha (ela pode estar velha); de um terminal, `allowed` vem vazio. Sem
 * `allowed` (a rota não conseguiu ler os destinos), fica a mensagem da rota.
 */
export function invalidTransitionMessage(
  error: Pick<TicketErrorBody, "message" | "allowed" | "current">,
  fromStatus: TicketStatusKey,
  statuses: StatusLabels
): string {
  if (!error.allowed) return error.message;
  const from = ticketStatusLabel(error.current ?? fromStatus, statuses);
  if (error.allowed.length === 0) return `De ${from} não vai para nenhum outro status.`;
  const targets = error.allowed.map((key) => ticketStatusLabel(key, statuses));
  return `De ${from} só vai para ${targets.join(", ")}.`;
}
