"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import type { ChatConversation, ConversationStatus } from "@/features/chat/types";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import {
  ticketFieldError,
  ticketRequest,
  type TicketRequestFailure,
} from "@/features/tickets/lib/ticket-request";
import type { TakeOverTicketData, TicketListItem } from "@/features/tickets/types";

const FAILURE_MESSAGE = "Não foi possível assumir o atendimento.";
const NETWORK_MESSAGE = "Não foi possível assumir o atendimento. Confira a conexão e tente de novo.";

/** O 409 `already_assigned` do "Assumir": o diálogo pergunta o que fazer. */
export type TakeOverConflict = {
  /** O ticket que estava em foco quando o "Assumir" saiu. */
  ticketId: string;
  /** "SUP-1024"; `null` quando o ticket em foco ainda não tinha sido lido. */
  protocol: string | null;
  /** Quem está com o ticket; `null` quando a rota não achou o nome. */
  assigneeName: string | null;
};

/** Qual passo está em voo: o botão dele gira. */
export type TakeOverStep = "take_over" | "reassign" | "conversation";

export type ConversationTakeOver = {
  /** O "Assumir" do cabeçalho: com foco, o take-over do ticket; sem, o PATCH de hoje. */
  takeOver: () => Promise<void>;
  pending: TakeOverStep | null;
  conflict: TakeOverConflict | null;
  /** "Assumir conversa e ticket": o take-over de novo, com `reassign: true`. */
  reassign: () => Promise<void>;
  /** "Só a conversa": o PATCH de hoje; o ticket fica com quem estava. */
  conversationOnly: () => Promise<void>;
  /** Fecha o diálogo sem fazer nada (Esc, toque fora). */
  dismiss: () => void;
};

function failureMessage(result: TicketRequestFailure): string {
  if (result.status === 0) return NETWORK_MESSAGE;
  return ticketFieldError(result.body) ?? result.body?.message ?? FAILURE_MESSAGE;
}

function requestTakeOver(ticketId: string, reassign: boolean) {
  return ticketRequest<{ ok: true } & TakeOverTicketData>(
    `/api/tickets/${encodeURIComponent(ticketId)}/take-over`,
    { method: "POST", body: reassign ? { reassign: true } : {} }
  );
}

/**
 * "Assumir" no cabeçalho do chat (spec 4e). Com ticket em foco, POST take-over:
 * conversa `human`, ticket com quem assumiu e novo|em_triagem → em_atendimento,
 * numa transação só. Sem foco, o PATCH da conversa de hoje (`onTakeover`).
 *
 * O foco é o `active_ticket_id` da conversa (Realtime), não a leitura dos
 * tickets: a falha dela não pode tirar do analista o take-over do ticket.
 *
 * O ticket com outro analista (409 `already_assigned`) abre o diálogo "SUP-1024
 * está com Ana": "Assumir conversa e ticket" refaz com `reassign: true`; "Só a
 * conversa" usa o PATCH de hoje. Depois de cada resposta, `refresh` relê os
 * tickets (sem Realtime de tickets). A conversa `human` que o take-over devolve
 * vai direto para a tela (`onConversationUpdate`): esperar o Realtime deixava o
 * cabeçalho e o compositor travados na IA, e ele pode nem chegar.
 *
 * Uma escrita por vez: a trava é uma ref, porque o `pending` só desabilita os
 * botões no próximo render.
 */
export function useConversationTakeOver({
  status,
  activeTicketId,
  activeTicket,
  onTakeover,
  onConversationUpdate,
  refresh,
}: {
  status: ConversationStatus;
  /** `chat_conversations.active_ticket_id`. */
  activeTicketId: string | null;
  /** O ticket em foco já lido (o protocolo do diálogo), ou `null`. */
  activeTicket: Pick<TicketListItem, "id" | "number"> | null;
  /** O PATCH da conversa de hoje (o `onTakeover` do `ChatShell`). */
  onTakeover: () => Promise<void> | void;
  /** A conversa que o take-over gravou: a lista e o cabeçalho (o par do `ChatShell`). */
  onConversationUpdate: (updated: Partial<ChatConversation> & { id: string }) => void;
  refresh: () => void;
}): ConversationTakeOver {
  const [pending, setPending] = useState<TakeOverStep | null>(null);
  const [conflict, setConflict] = useState<TakeOverConflict | null>(null);
  const inFlight = useRef(false);

  async function run(step: TakeOverStep, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(step);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const takeOver = () =>
    run("take_over", async () => {
      if (!activeTicketId) {
        await onTakeover();
        return;
      }

      const result = await requestTakeOver(activeTicketId, false);
      if (result.ok) {
        onConversationUpdate(result.data.conversation);
        toast.success(`Você assumiu ${formatProtocol(result.data.ticket.number)}.`);
        refresh();
        return;
      }

      if (result.body?.code === "already_assigned") {
        setConflict({
          ticketId: activeTicketId,
          protocol:
            activeTicket?.id === activeTicketId ? formatProtocol(activeTicket.number) : null,
          assigneeName: result.body.assigned_to_name ?? null,
        });
        // A tela está velha (outro analista pegou): relê enquanto o diálogo pergunta.
        refresh();
        return;
      }

      toast.error(failureMessage(result));
      // O foco em tela está velho (ticket encerrado, sumiu): relê.
      if (result.status === 404 || result.status === 409) refresh();
    });

  const reassign = () =>
    run("reassign", async () => {
      if (!conflict) return;
      const result = await requestTakeOver(conflict.ticketId, true);
      if (result.ok) {
        setConflict(null);
        onConversationUpdate(result.data.conversation);
        toast.success(`Você assumiu ${formatProtocol(result.data.ticket.number)}.`);
        refresh();
        return;
      }

      toast.error(failureMessage(result));
      // Sem rede, o diálogo fica para tentar de novo; o resto é resposta final.
      if (result.status === 0) return;
      setConflict(null);
      if (result.status === 404 || result.status === 409) refresh();
    });

  const conversationOnly = () =>
    run("conversation", async () => {
      // O PATCH de hoje ALTERNA: se a conversa já virou humana enquanto o
      // diálogo perguntava (Realtime), ele a devolveria à IA.
      if (status !== "human") await onTakeover();
      setConflict(null);
    });

  const dismiss = () => {
    if (inFlight.current) return;
    setConflict(null);
  };

  return { takeOver, pending, conflict, reassign, conversationOnly, dismiss };
}
