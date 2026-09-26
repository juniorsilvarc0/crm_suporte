"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { formatProtocol } from "@/features/tickets/lib/protocol";
import { ticketActionErrorMessage } from "@/features/tickets/lib/ticket-action-error";
import {
  ticketStatusLabel,
  type TicketQuickAction,
  type TicketQuickActionId,
} from "@/features/tickets/lib/ticket-actions";
import { ticketRequest } from "@/features/tickets/lib/ticket-request";
import type {
  TicketListItem,
  TicketStatusOption,
  TransitionTicketData,
} from "@/features/tickets/types";

/** O que a ação lê do ticket: a URL, o toast e a versão que a tela leu. */
export type QuickActionTarget = Pick<TicketListItem, "id" | "number" | "status" | "version">;

export type TicketQuickActionRunner = {
  /** Roda a ação; `true` = deu certo. Uma por vez: a 2ª, com outra em voo, é ignorada. */
  run: (ticket: QuickActionTarget, action: TicketQuickAction) => Promise<boolean>;
  /** O ticket e a ação em voo (o botão dela gira), ou `null`. */
  pending: { ticketId: string; actionId: TicketQuickActionId } | null;
};

/**
 * Uma ação rápida (`quickActions`) fora do detalhe: Atender = POST take-over;
 * as outras = POST transition com `{ to, version }`. Sem Realtime de tickets:
 * `refresh` relê a tela depois do sucesso, e também depois de 404/409 (o ticket
 * em tela está velho: mudou, foi pego ou sumiu).
 *
 * A trava é uma ref: o `pending` só desabilita os botões no próximo render, e a
 * 2ª ação sairia com a versão de antes da 1ª.
 */
export function useTicketQuickAction({
  statuses,
  refresh,
}: {
  /** Rótulos do catálogo para o toast; `null` = os de recurso. */
  statuses: readonly TicketStatusOption[] | null;
  refresh: () => void;
}): TicketQuickActionRunner {
  const [pending, setPending] = useState<TicketQuickActionRunner["pending"]>(null);
  const inFlight = useRef(false);

  async function run(ticket: QuickActionTarget, action: TicketQuickAction): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending({ ticketId: ticket.id, actionId: action.id });

    const base = `/api/tickets/${encodeURIComponent(ticket.id)}`;
    const result =
      action.kind === "take_over"
        ? await ticketRequest<unknown>(`${base}/take-over`, { method: "POST", body: {} })
        : await ticketRequest<TransitionTicketData>(`${base}/transition`, {
            method: "POST",
            body: { to: action.to, version: ticket.version },
          });

    inFlight.current = false;
    setPending(null);

    const protocol = formatProtocol(ticket.number);
    if (result.ok) {
      if (action.kind === "take_over") toast.success(`Você assumiu ${protocol}.`);
      // `changed: false` = já estava lá: nada a avisar.
      else if ((result.data as TransitionTicketData).changed) {
        toast.success(`${protocol} movido para ${ticketStatusLabel(action.to, statuses)}.`);
      }
      refresh();
      return true;
    }

    toast.error(ticketActionErrorMessage(result, ticket.status, statuses));
    if (result.status === 404 || result.status === 409) refresh();
    return false;
  }

  return { run, pending };
}
