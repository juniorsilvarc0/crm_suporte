"use client";

import { useEffect, useRef } from "react";
import { subscribeAuthenticated } from "@/lib/supabase/client";
import { deliveredRow as delivered } from "@/features/chat/lib/realtime-payload";
import type { ChatConversation, ChatMessage } from "@/features/chat/types";

type UseChatRealtimeProps = {
  conversationId: string | null;
  onNewMessage: (msg: ChatMessage) => void;
  onConversationUpdate?: (conv: Partial<ChatConversation> & { id: string }) => void;
  onNewConversation?: (conv: ChatConversation) => void;
};

export function useChatRealtime({
  conversationId,
  onNewMessage,
  onConversationUpdate,
  onNewConversation,
}: UseChatRealtimeProps) {
  // Callbacks em refs atualizadas a cada render. A subscrição é criada uma única
  // vez, mas os handlers chamam sempre a closure ATUAL — assim uma conversa nova
  // via realtime respeita o statusFilter/search corrente (e não o do 1º render).
  const onNewMessageRef = useRef(onNewMessage);
  const onConversationUpdateRef = useRef(onConversationUpdate);
  const onNewConversationRef = useRef(onNewConversation);
  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
    onConversationUpdateRef.current = onConversationUpdate;
    onNewConversationRef.current = onNewConversation;
  });

  useEffect(() => {
    if (!conversationId) return;

    return subscribeAuthenticated((supabase) =>
      supabase
        .channel(`chat-messages:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const row = delivered(payload);
            if (row) onNewMessageRef.current(row as ChatMessage);
          }
        )
        // UPDATE: a mídia (FileDownloaded) e os ticks (delivery_status) chegam por
        // aqui — sem isto o áudio/imagem fica vazio e os ticks não evoluem ao vivo.
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "chat_messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const row = delivered(payload);
            if (row) onNewMessageRef.current(row as ChatMessage);
          }
        )
    );
  }, [conversationId]);

  useEffect(() => {
    return subscribeAuthenticated((supabase) =>
      supabase
        .channel("chat-conversations-list")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "chat_conversations" },
          (payload) => {
            const row = delivered(payload);
            if (row) {
              onConversationUpdateRef.current?.(
                row as Partial<ChatConversation> & { id: string }
              );
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_conversations" },
          (payload) => {
            const row = delivered(payload);
            if (row) onNewConversationRef.current?.(row as ChatConversation);
          }
        )
    );
  }, []);
}
