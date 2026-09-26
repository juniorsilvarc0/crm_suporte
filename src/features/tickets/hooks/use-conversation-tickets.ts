"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConversationStatus } from "@/features/chat/types";
import { ticketRequest } from "@/features/tickets/lib/ticket-request";
import type { ConversationTickets, TicketListItem } from "@/features/tickets/types";

// A retomada (inbound em "aguardando cliente" volta para "em atendimento") e a
// rajada de mensagens do cliente viram UMA releitura, 1 s depois da última.
export const INBOUND_REFRESH_DELAY_MS = 1_000;

type Snapshot = {
  conversationId: string;
  /** A última leitura boa desta conversa. */
  data: ConversationTickets | null;
  /** Instante (ISO) em que ela chegou: o `useNow` do selo de SLA começa nele. */
  fetchedAt: string | null;
  /** A última leitura falhou. */
  error: boolean;
};

export type ConversationTicketsState = {
  /** `null` = ainda não chegou (ou falhou antes da 1ª). Nunca é de outra conversa. */
  data: ConversationTickets | null;
  /**
   * O ticket em foco, pelo `activeTicketId` da conversa (Realtime, o mais novo)
   * dentro da lista lida. `null` sem foco, ou enquanto a releitura não o trouxe.
   */
  activeTicket: TicketListItem | null;
  fetchedAt: string | null;
  /** Sem dado desta conversa e sem erro: a 1ª leitura está a caminho. */
  loading: boolean;
  /**
   * A última leitura falhou. Com `data`, ela é a anterior (velha); sem `data`, a
   * tela mostra "Tentar de novo" (`refresh`), nunca "nenhum ticket".
   */
  error: boolean;
  /** Relê agora: o "Tentar de novo" e a volta de cada ação de ticket. */
  refresh: () => void;
  /** Mensagem do cliente chegou: relê 1 s depois da última (debounce). */
  notifyInbound: () => void;
};

/**
 * Os tickets NÃO terminais da conversa aberta e o foco dela, para o chip do
 * cabeçalho e o grupo "Tickets" do painel do contato (GET
 * /api/tickets?conversation_id=).
 *
 * Sem Realtime de tickets: relê quando muda a conversa, o foco
 * (`active_ticket_id`) ou o `status` da conversa (que chegam pelo Realtime do
 * chat, inclusive de outra aba), ao voltar para a aba, depois de cada ação
 * (`refresh`) e no inbound (`notifyInbound`).
 *
 * Só a leitura mais nova vale: cada uma cancela a anterior, e a resposta de uma
 * conversa que já saiu da tela é descartada.
 */
export function useConversationTickets(
  conversationId: string | null,
  activeTicketId: string | null,
  status: ConversationStatus | null
): ConversationTicketsState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  /** Incrementar relê: é o `refresh`, a volta para a aba e o inbound. */
  const [attempt, setAttempt] = useState(0);
  const inboundTimer = useRef<number | null>(null);

  const clearInboundTimer = useCallback(() => {
    if (inboundTimer.current === null) return;
    window.clearTimeout(inboundTimer.current);
    inboundTimer.current = null;
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();

    async function load(id: string) {
      const result = await ticketRequest<{ ok: true } & ConversationTickets>(
        `/api/tickets?conversation_id=${encodeURIComponent(id)}`,
        { signal: controller.signal }
      );
      // Veio outra leitura depois desta (conversa trocada, foco mudou): descarta.
      if (controller.signal.aborted) return;

      if (result.ok) {
        setSnapshot({
          conversationId: id,
          data: { active_ticket_id: result.data.active_ticket_id, tickets: result.data.tickets },
          fetchedAt: new Date().toISOString(),
          error: false,
        });
        return;
      }
      // Falha mantém a última leitura boa DESTA conversa, nunca a de outra.
      setSnapshot((previous) => ({
        conversationId: id,
        data: previous?.conversationId === id ? previous.data : null,
        fetchedAt: previous?.conversationId === id ? previous.fetchedAt : null,
        error: true,
      }));
    }

    // O `setState` mora depois do `await`, não no corpo do efeito (molde de
    // `useContactInfo`).
    void load(conversationId);

    return () => {
      // A leitura que vem agora cobre a releitura do inbound que estava pendente.
      clearInboundTimer();
      controller.abort();
    };
  }, [conversationId, activeTicketId, status, attempt, clearInboundTimer]);

  // Sem Realtime de tickets: voltar para a aba relê.
  useEffect(() => {
    if (!conversationId) return;
    function onVisibility() {
      if (document.visibilityState === "visible") setAttempt((current) => current + 1);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [conversationId]);

  const refresh = useCallback(() => {
    if (!conversationId) return;
    // "Tentar de novo" volta ao carregando em vez de deixar o erro na tela.
    setSnapshot((previous) =>
      previous?.conversationId === conversationId && previous.error
        ? { ...previous, error: false }
        : previous
    );
    setAttempt((current) => current + 1);
  }, [conversationId]);

  const notifyInbound = useCallback(() => {
    if (!conversationId) return;
    clearInboundTimer();
    inboundTimer.current = window.setTimeout(() => {
      inboundTimer.current = null;
      setAttempt((current) => current + 1);
    }, INBOUND_REFRESH_DELAY_MS);
  }, [conversationId, clearInboundTimer]);

  const own = conversationId !== null && snapshot?.conversationId === conversationId ? snapshot : null;
  const data = own?.data ?? null;
  const error = own?.error ?? false;

  return {
    data,
    activeTicket: activeTicketId
      ? (data?.tickets.find((ticket) => ticket.id === activeTicketId) ?? null)
      : null,
    fetchedAt: own?.fetchedAt ?? null,
    loading: conversationId !== null && data === null && !error,
    error,
    refresh,
    notifyInbound,
  };
}
