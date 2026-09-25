"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  conversationMatchesBox,
  mergeConversationRealtimeUpdate,
} from "@/features/chat/lib/conversation-list";
import type { ConversationBox } from "@/features/chat/lib/chat-filters";
import {
  detectConversationPromotion,
  type ConversationPromotion,
} from "@/features/chat/lib/conversation-scroll";
import type { ChatConversation } from "@/features/chat/types";

type UseConversationsOptions = {
  /**
   * A caixa carregada. É o ÚNICO recorte que ainda vale uma consulta: alternar
   * responsável/etapa/etiqueta filtra a lista já em memória, sem rede.
   */
  box?: ConversationBox;
  search?: string;
};

type ConversationsState = {
  conversations: ChatConversation[];
  promotedConversationCount: number;
  lastPromotion: (ConversationPromotion & { sequence: number }) | null;
};

const initialState: ConversationsState = {
  conversations: [],
  promotedConversationCount: 0,
  lastPromotion: null,
};

function conversationIds(conversations: readonly ChatConversation[]): string[] {
  return conversations.map((conversation) => conversation.id);
}

function withPromotion(
  state: ConversationsState,
  conversations: ChatConversation[],
  changedId: string
): ConversationsState {
  const promotion = detectConversationPromotion(
    conversationIds(state.conversations),
    conversationIds(conversations),
    changedId
  );
  if (!promotion) return { ...state, conversations };

  const sequence = state.promotedConversationCount + 1;
  return {
    conversations,
    promotedConversationCount: sequence,
    lastPromotion: { ...promotion, sequence },
  };
}

export function useConversations({
  box = "active",
  search = "",
}: UseConversationsOptions = {}) {
  const [state, setState] = useState(initialState);
  const [loading, setLoading] = useState(true);
  const [archivedCount, setArchivedCount] = useState(0);

  const fetchConversations = useCallback(async () => {
    const params = new URLSearchParams({ status: box === "archived" ? "archived" : "all" });
    if (search.trim()) params.set("search", search.trim());

    const response = await fetch(`/api/chat/conversations?${params.toString()}`);
    if (response.ok) {
      const data = (await response.json()) as { conversations?: ChatConversation[] };
      setState((current) => ({
        ...current,
        conversations: data.conversations ?? [],
      }));
    }
    setLoading(false);
  }, [box, search]);

  useEffect(() => {
    // Data fetch on mount / when filters change; state is set from the
    // Supabase response (an external system), which is the intended use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchConversations();
  }, [fetchConversations]);

  /**
   * Quantas conversas estão arquivadas — o número da linha de atalho.
   *
   * Conta no banco em vez de medir a lista: a lista carregada é a do filtro
   * atual, e vendo "Tudo" ela não tem nenhuma arquivada para contar.
   *
   * `head: true` não traz linha nenhuma, só o total no cabeçalho.
   */
  const fetchArchivedCount = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { count, error } = await supabase
      .from("chat_conversations")
      .select("id", { count: "exact", head: true })
      .is("removed_at", null)
      .not("archived_at", "is", null);
    if (!error) setArchivedCount(count ?? 0);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchArchivedCount();
  }, [fetchArchivedCount]);

  const updateConversation = useCallback(
    (updated: Partial<ChatConversation> & { id: string }) => {
      // Arquivar/desarquivar move a conversa entre as duas caixas, então o
      // contador do atalho precisa ser recontado. Mensagem chegando não mexe
      // nisso — recontar a cada update seria uma ida ao banco por mensagem.
      if ("archived_at" in updated) void fetchArchivedCount();

      setState((current) => {
        // Uma conversa removida continua no banco. Quando chega mensagem, o
        // backend restaura a linha por UPDATE (não INSERT); o payload completo
        // do Realtime pode voltar à lista sem refresh.
        const conversations = mergeConversationRealtimeUpdate(
          current.conversations,
          updated,
          box,
          search
        );
        if (conversations === current.conversations) return current;
        return withPromotion(current, conversations, updated.id);
      });
    },
    [box, search, fetchArchivedCount]
  );

  const removeConversation = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      conversations: current.conversations.filter(
        (conversation) => conversation.id !== id
      ),
    }));
  }, []);

  // Nova conversa chegou pelo realtime (INSERT). Prepende só se casar com o
  // filtro de status E com a busca atuais, e ainda não estiver na lista.
  const addConversation = useCallback(
    (conv: ChatConversation) => {
      if (!conversationMatchesBox(conv, box)) return;
      const term = search.trim().toLowerCase();
      if (term) {
        const name = (conv.contact_name ?? "").toLowerCase();
        const phone = (conv.contact_phone ?? "").toLowerCase();
        if (!name.includes(term) && !phone.includes(term)) return;
      }
      setState((current) => {
        if (current.conversations.some((conversation) => conversation.id === conv.id)) {
          return current;
        }
        return withPromotion(current, [conv, ...current.conversations], conv.id);
      });
    },
    [box, search]
  );

  const markAsRead = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) =>
        conversation.id === id
          ? { ...conversation, unread_count: 0 }
          : conversation
      ),
    }));
  }, []);

  return {
    conversations: state.conversations,
    promotedConversationCount: state.promotedConversationCount,
    lastPromotion: state.lastPromotion,
    archivedCount,
    loading,
    refetch: fetchConversations,
    updateConversation,
    addConversation,
    markAsRead,
    removeConversation,
  };
}
