"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ChatConversation,
  ChatMessage,
  ConversationStatus,
} from "@/features/chat/types";
import { useChatRealtime } from "@/features/chat/hooks/use-chat-realtime";
import { oldestCursor, prependOlder } from "@/features/chat/lib/messages-page";
import {
  createOptimisticMessage,
  keepUnconfirmed,
  newClientId,
  readClientId,
  setSendStatus,
  upsertMessage,
} from "@/features/chat/lib/outgoing-message";

type UseMessagesOptions = {
  onConversationUpdate?: (
    updated: Partial<ChatConversation> & { id: string }
  ) => void;
  onNewConversation?: (conv: ChatConversation) => void;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // strip the data:...;base64, prefix
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function useMessages({
  onConversationUpdate,
  onNewConversation,
}: UseMessagesOptions = {}) {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Verdadeiro depois de um pulo da busca: a janela na tela NÃO termina na
  // última mensagem. Quem quiser voltar ao fim precisa recarregar, não rolar.
  const [windowed, setWindowed] = useState(false);
  const [currentConversation, setCurrentConversation] =
    useState<ChatConversation | null>(null);

  /**
   * A conversa que a tela DEVE estar mostrando.
   *
   * ⚠️ Ref, e não estado: quem consulta é o callback de uma requisição que **já
   * está no ar**, e ele precisa do valor de agora — não do que a closure
   * capturou quando a requisição partiu.
   *
   * Sem esta guarda, tocar em duas conversas seguidas num 4G ruim deixava a
   * resposta da PRIMEIRA chegar por último e sobrescrever a tela: cabeçalho,
   * nome, telefone e histórico da conversa A, com `selectedConversationId`
   * apontando para B. Todo envio saía para B enquanto o operador lia A — no
   * suporte, isso é resposta sobre o chamado de um cliente indo para o WhatsApp
   * de outro.
   */
  const activeConversation = useRef<string | null>(null);

  const fetchMessages = useCallback(async (conversationId: string) => {
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}`);
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as {
        conversation: ChatConversation;
        messages: ChatMessage[];
        hasMore?: boolean;
      };
      if (activeConversation.current !== conversationId) return;
      setCurrentConversation(json.conversation);
      // `keepUnconfirmed`: um envio que ainda está no ar não está na resposta do
      // banco, e trocar a lista pela do servidor apagaria a bolha debaixo do
      // olho de quem acabou de apertar Enter.
      setMessages((current) => keepUnconfirmed(json.messages, current));
      setHasMoreMessages(Boolean(json.hasMore));
      setWindowed(false);
    } catch {
      // Falhou uma conversa que o operador já abandonou: o aviso seria sobre
      // uma tela que não existe mais.
      if (activeConversation.current !== conversationId) return;
      toast.error("Não foi possível carregar as mensagens.");
    } finally {
      // `messagesLoading` é compartilhado. Desligar aqui pela conversa antiga
      // apagaria o carregando da conversa que o operador está esperando.
      if (activeConversation.current === conversationId) {
        setMessagesLoading(false);
      }
    }
  }, []);

  /**
   * Recarrega a conversa centrada numa mensagem — o pulo do resultado da busca.
   *
   * Substitui a janela em vez de acrescentar: o alvo pode estar centenas de
   * mensagens atrás, e emendar as duas faixas deixaria um buraco silencioso no
   * meio da conversa.
   */
  const loadAroundMessage = useCallback(
    async (messageId: string) => {
      const conversationId = selectedConversationId;
      if (!conversationId) return false;
      setMessagesLoading(true);
      try {
        const res = await fetch(
          `/api/chat/conversations/${conversationId}?around=${messageId}`
        );
        if (!res.ok) throw new Error("fetch failed");
        const json = (await res.json()) as {
          conversation: ChatConversation;
          messages: ChatMessage[];
          hasMore?: boolean;
        };
        // Mesma guarda do `fetchMessages`: o pulo da busca é lento por natureza
        // (recarrega a janela inteira), então é justamente onde dá tempo de
        // trocar de conversa no meio.
        if (activeConversation.current !== conversationId) return false;
        setCurrentConversation(json.conversation);
        setMessages((current) => keepUnconfirmed(json.messages, current));
        setHasMoreMessages(Boolean(json.hasMore));
        setWindowed(true);
        return true;
      } catch {
        if (activeConversation.current !== conversationId) return false;
        toast.error("Não foi possível abrir essa mensagem.");
        return false;
      } finally {
        if (activeConversation.current === conversationId) {
          setMessagesLoading(false);
        }
      }
    },
    [selectedConversationId]
  );

  /**
   * Página anterior do histórico. Sem isto, conversa com mais de 100 mensagens
   * tinha o começo inalcançável — o dado existia no banco e não chegava na tela.
   */
  const loadOlderMessages = useCallback(async () => {
    const conversationId = selectedConversationId;
    if (!conversationId || loadingOlder || !hasMoreMessages) return;

    const cursor = oldestCursor(messages);
    if (!cursor) return;

    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({ before: cursor.createdAt, beforeId: cursor.id });
      const res = await fetch(
        `/api/chat/conversations/${conversationId}?${params}`
      );
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as { messages: ChatMessage[]; hasMore?: boolean };

      // `prependOlder` recebe a lista ATUAL. Sem esta guarda, trocar de conversa
      // durante a busca fazia as 100 mensagens antigas de A entrarem na tela de
      // B — histórico de um cliente dentro da conversa de outro.
      if (activeConversation.current !== conversationId) return;
      setMessages((current) => prependOlder(json.messages, current));
      setHasMoreMessages(Boolean(json.hasMore));
    } catch {
      if (activeConversation.current !== conversationId) return;
      toast.error("Não foi possível carregar mensagens antigas.");
    } finally {
      if (activeConversation.current === conversationId) setLoadingOlder(false);
    }
  }, [selectedConversationId, loadingOlder, hasMoreMessages, messages]);

  /** Volta a janela para o fim da conversa — o "ir para a última" depois de um
   *  pulo da busca, que não pode ser só um scroll. */
  const reloadLatest = useCallback(async () => {
    if (!selectedConversationId) return;
    await fetchMessages(selectedConversationId);
  }, [selectedConversationId, fetchMessages]);

  const selectConversation = useCallback(
    (id: string | null) => {
      // Tocar de novo na conversa JÁ ABERTA E CARREGADA não recarrega nada: a
      // lista voltaria ao esqueleto de carregando e levaria junto os envios que
      // ainda estão no ar. Acontece toda vez que se clica no item já
      // selecionado da lista.
      //
      // A condição é "carregada", não só "selecionada": depois de uma busca que
      // falhou, clicar de novo é justamente como se tenta outra vez.
      if (id !== null && id === activeConversation.current && currentConversation?.id === id) {
        return;
      }
      // Antes de qualquer `setState`: é este ref que invalida as respostas em
      // voo da conversa anterior.
      activeConversation.current = id;
      setSelectedConversationId(id);
      setMessages([]);
      setCurrentConversation(null);
      // Paginação é da conversa anterior. `loadingOlder` preso em `true` (o que
      // acontece quando uma página é abandonada no meio) deixaria o botão de
      // "carregar anteriores" desabilitado para sempre na conversa nova.
      setHasMoreMessages(false);
      setLoadingOlder(false);
      setWindowed(false);
      if (id) void fetchMessages(id);
    },
    [fetchMessages, currentConversation?.id]
  );

  const applyConversationUpdate = useCallback(
    (updated: Partial<ChatConversation> & { id: string }) => {
      setCurrentConversation((current) =>
        current?.id === updated.id ? { ...current, ...updated } : current
      );
    },
    []
  );

  const clearConversationMessages = useCallback(
    (conversationId: string) => {
      if (selectedConversationId !== conversationId) return;
      setMessages([]);
      setHasMoreMessages(false);
      setWindowed(false);
    },
    [selectedConversationId]
  );

  /**
   * Entrada única de mensagem na tela — vale para o Realtime, para a resposta do
   * envio e para o que a edição/exclusão devolve.
   *
   * ⚠️ A guarda de conversa não é zelo: `sendMessage` resolve DEPOIS que o
   * operador já pode ter trocado de contato, e sem ela a mensagem enviada para
   * A entrava na lista aberta de B. No suporte, é o histórico de um cliente
   * aparecendo na conversa de outro.
   */
  const upsertLocal = useCallback((msg: ChatMessage) => {
    if (msg.conversation_id !== activeConversation.current) return;
    setMessages((prev) => upsertMessage(prev, msg));
  }, []);

  useChatRealtime({
    conversationId: selectedConversationId,
    onNewMessage: upsertLocal,
    // A lista (quem chamou) E o cabeçalho da conversa aberta: mudança feita em
    // outra aba (status, ticket em foco) chega por aqui, e só a lista mudava.
    onConversationUpdate: (updated) => {
      applyConversationUpdate(updated);
      onConversationUpdate?.(updated);
    },
    onNewConversation,
  });

  /**
   * A requisição de um envio — a mesma para o primeiro disparo e para o retry.
   *
   * O `clientId` viaja no corpo: é ele que faz a rota reaproveitar a linha em
   * vez de criar outra. Sem isso, tentar de novo depois de uma falha de rede que
   * o servidor **já tinha processado** mandaria a mesma mensagem duas vezes ao
   * cliente.
   */
  const dispatchSend = useCallback(
    async (
      conversationId: string,
      clientId: string,
      payload: { content: string; quotedMessageId?: string | null }
    ) => {
      try {
        const res = await fetch(`/api/chat/conversations/${conversationId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: payload.content,
            type: "text",
            clientId,
            ...(payload.quotedMessageId
              ? { quotedMessageId: payload.quotedMessageId }
              : {}),
          }),
        });
        if (!res.ok) throw new Error("send failed");
        const json = (await res.json()) as { message?: ChatMessage };
        if (json.message) upsertLocal(json.message);
      } catch {
        // Com a conversa na tela, o aviso é a PRÓPRIA bolha: ✕ e "Tentar
        // novamente", com o texto preservado. Torradinha por cima disso seria
        // ruído. Ela só volta a existir quando não há bolha para avisar —
        // quando o operador já trocou de conversa.
        if (activeConversation.current === conversationId) {
          setMessages((prev) => setSendStatus(prev, clientId, "failed"));
          return;
        }
        toast.error("Não foi possível enviar a mensagem.");
      }
    },
    [upsertLocal]
  );

  /**
   * Envio otimista: a bolha entra na conversa no mesmo quadro do Enter e o
   * composer fica livre na hora. O estado de envio é da mensagem — dois envios
   * seguidos são dois relógios independentes, e um travar não trava o outro.
   */
  const sendMessage = useCallback(
    async (
      content: string,
      quotedMessageId?: string | null,
      /** Texto exato que sairá para o contato (assinatura já aplicada). */
      outboundPreview?: string
    ) => {
      const conversationId = selectedConversationId;
      const text = content.trim();
      if (!conversationId || !text) return;

      const clientId = newClientId();
      setMessages((prev) => [
        ...prev,
        createOptimisticMessage({
          conversationId,
          clientId,
          content: outboundPreview ?? text,
          quotedMessageId,
        }),
      ]);

      await dispatchSend(conversationId, clientId, { content: text, quotedMessageId });
    },
    [selectedConversationId, dispatchSend]
  );

  /**
   * "Tentar novamente" de uma mensagem que falhou.
   *
   * Não recria mensagem: reusa o `clientId` da que está na tela, então a rota
   * reaproveita a linha e reenvia o conteúdo **já gravado** — sem assinar duas
   * vezes e sem uma segunda bolha.
   */
  const retrySendMessage = useCallback(
    async (message: ChatMessage) => {
      const clientId = readClientId(message);
      if (!clientId || message.conversation_id !== activeConversation.current) return;

      setMessages((prev) => setSendStatus(prev, clientId, "pending"));
      await dispatchSend(message.conversation_id, clientId, {
        content: message.content ?? "",
        quotedMessageId: message.quoted_message_id,
      });
    },
    [dispatchSend]
  );

  const sendNote = useCallback(
    async (content: string) => {
      if (!selectedConversationId || !content.trim()) return;
      try {
        const res = await fetch(
          `/api/chat/conversations/${selectedConversationId}/send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: content.trim(), kind: "note" }),
          }
        );
        if (!res.ok) throw new Error("note failed");
        const json = (await res.json()) as { message?: ChatMessage };
        if (json.message) upsertLocal(json.message);
      } catch {
        toast.error("Não foi possível salvar a anotação.");
      }
    },
    [selectedConversationId, upsertLocal]
  );

  const sendAudio = useCallback(
    async (blob: Blob, seconds: number, quotedMessageId?: string | null) => {
      if (!selectedConversationId) return;
      try {
        const base64 = await blobToBase64(blob);
        const res = await fetch(
          `/api/chat/conversations/${selectedConversationId}/send-audio`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audioBase64: base64,
              mimeType: blob.type || "audio/webm",
              seconds,
              ...(quotedMessageId ? { quotedMessageId } : {}),
            }),
          }
        );
        if (!res.ok) throw new Error("audio failed");
        const json = (await res.json()) as { message?: ChatMessage };
        if (json.message) upsertLocal(json.message);
      } catch {
        toast.error("Não foi possível enviar o áudio.");
      }
    },
    [selectedConversationId, upsertLocal]
  );

  const sendFile = useCallback(
    async (file: File, quotedMessageId?: string | null, caption?: string) => {
      if (!selectedConversationId) return false;
      if (file.size > 64 * 1024 * 1024) {
        toast.error("Arquivo muito grande (máx. 64MB).");
        return false;
      }
      try {
        // multipart/form-data (binário puro) — muito mais rápido que base64 e
        // sem estourar limite de body em vídeos/arquivos grandes.
        const form = new FormData();
        form.append("file", file);
        if (quotedMessageId) form.append("quotedMessageId", quotedMessageId);
        if (caption?.trim()) form.append("caption", caption.trim());
        const res = await fetch(
          `/api/chat/conversations/${selectedConversationId}/send-file`,
          { method: "POST", body: form }
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? "file failed");
        }
        const json = (await res.json()) as { message?: ChatMessage };
        if (json.message) upsertLocal(json.message);
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Não foi possível enviar o anexo."
        );
        return false;
      }
    },
    [selectedConversationId, upsertLocal]
  );

  /**
   * Edita o texto (ou a legenda) de uma mensagem nossa.
   *
   * A rota só grava depois do 200 da uazapi, então o que volta aqui já é a
   * mensagem confirmada nos dois lados — nada de otimismo local, que deixaria a
   * tela mostrando um texto que o cliente não recebeu.
   */
  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!selectedConversationId || !text.trim()) return false;
      try {
        const res = await fetch(
          `/api/chat/conversations/${selectedConversationId}/messages/${messageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.trim() }),
          }
        );
        const json = (await res.json().catch(() => ({}))) as {
          message?: ChatMessage;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "edit failed");
        if (json.message) upsertLocal(json.message);
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Não foi possível editar a mensagem."
        );
        return false;
      }
    },
    [selectedConversationId, upsertLocal]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!selectedConversationId) return false;
      try {
        const res = await fetch(
          `/api/chat/conversations/${selectedConversationId}/messages/${messageId}`,
          { method: "DELETE" }
        );
        const json = (await res.json().catch(() => ({}))) as {
          message?: ChatMessage;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "delete failed");
        if (json.message) upsertLocal(json.message);
        toast.success("Mensagem apagada.");
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Não foi possível apagar a mensagem."
        );
        return false;
      }
    },
    [selectedConversationId, upsertLocal]
  );

  /**
   * Encaminha para outras conversas. As cópias nascem lá, não aqui — por isso
   * nada é adicionado à lista atual; o retorno é só a contagem para o aviso.
   */
  const forwardMessages = useCallback(
    async (messageIds: string[], targetConversationIds: string[]) => {
      if (!selectedConversationId) return false;
      try {
        const res = await fetch(
          `/api/chat/conversations/${selectedConversationId}/forward`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageIds, targetConversationIds }),
          }
        );
        const json = (await res.json().catch(() => ({}))) as {
          sent?: number;
          failed?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "forward failed");

        const sent = json.sent ?? 0;
        const failed = json.failed ?? 0;
        if (sent === 0) {
          toast.error("Nada foi encaminhado.");
          return false;
        }
        toast.success(
          failed > 0
            ? `${sent} encaminhada(s). ${failed} falhou(aram).`
            : `Encaminhada(s) para ${targetConversationIds.length} conversa(s).`
        );
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Não foi possível encaminhar."
        );
        return false;
      }
    },
    [selectedConversationId]
  );

  const setConversationStatus = useCallback(
    async (status: ConversationStatus) => {
      if (!selectedConversationId) return;
      try {
        const res = await fetch(
          `/api/chat/conversations/${selectedConversationId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }
        );
        if (!res.ok) throw new Error("patch failed");
        // Só o que a rota grava (o status), não a linha que ela devolve: a
        // resposta que chega depois de um Realtime mais novo voltaria a prévia,
        // a ordem e as não lidas. O `applyConversationUpdate` confere o id: a
        // resposta que chega depois de trocar de conversa não pinta o cabeçalho
        // da outra.
        const updated = { id: selectedConversationId, status };
        applyConversationUpdate(updated);
        onConversationUpdate?.(updated);
      } catch {
        toast.error("Não foi possível atualizar o status.");
      }
    },
    [selectedConversationId, onConversationUpdate, applyConversationUpdate]
  );

  return {
    selectedConversationId,
    selectConversation,
    messages,
    messagesLoading,
    hasMoreMessages,
    loadingOlder,
    loadOlderMessages,
    loadAroundMessage,
    windowed,
    reloadLatest,
    sendMessage,
    retrySendMessage,
    sendAudio,
    sendFile,
    sendNote,
    editMessage,
    deleteMessage,
    forwardMessages,
    currentConversation,
    setConversationStatus,
    applyConversationUpdate,
    clearConversationMessages,
  };
}
