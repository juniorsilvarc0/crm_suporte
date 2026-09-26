"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ConversationsList } from "@/features/chat/components/conversations-list";
import type { ConversationAction } from "@/features/chat/components/conversation-actions";
import { ChatView } from "@/features/chat/components/chat-view";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { useConversationTags } from "@/features/chat/hooks/use-conversation-tags";
import { useConversations } from "@/features/chat/hooks/use-conversations";
import {
  EMPTY_FILTERS,
  boxOf,
  matchesChatFilters,
  type ChatFilters,
} from "@/features/chat/lib/chat-filters";
import { useMessages } from "@/features/chat/hooks/use-messages";
import type { ChatConversation } from "@/features/chat/types";
import { useViewportHeight } from "@/lib/use-viewport-height";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

// Compara dois telefones de forma tolerante: normaliza para só dígitos e casa
// pela cauda comum. Comparar os últimos 8 dígitos (número do assinante) absorve
// tanto o DDI (55) quanto o 9º dígito móvel brasileiro, que aparecem/somem
// conforme a origem do número.
function phonesMatch(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  if (da.length < 8 || db.length < 8) return false;
  if (da === db) return true;
  return da.slice(-8) === db.slice(-8);
}

export function ChatShell() {
  // Um objeto só para os quatro filtros. Separados em quatro `useState`, a
  // combinação vira quatro fontes que precisam concordar — e "limpar tudo"
  // vira quatro chamadas que podem ficar pela metade.
  const [filters, setFilters] = useState<ChatFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [takeoverLoading, setTakeoverLoading] = useState(false);
  const isNarrow = useMediaQuery("(max-width: 1023.98px)");
  // A busca da conversa mora aqui, e não no ChatView, porque o Cmd+F precisa
  // escolher entre ela e a de contatos — e só este componente enxerga as duas.
  const [searchOpen, setSearchOpen] = useState(false);
  // Contador, não booleano: pedir foco duas vezes seguidas no campo de contatos
  // tem de funcionar nas duas, e um booleano só mudaria de valor na primeira.
  const [focusContacts, setFocusContacts] = useState(0);

  /**
   * Rascunho por conversa — o que ficou escrito e não foi enviado.
   *
   * Mora AQUI, e não no compositor, porque o `ChatView` é desmontado a cada
   * troca de conversa (enquanto a nova carrega, o painel volta a ser o vazio).
   * Com o estado lá dentro, meia frase digitada para um cliente evaporava ao
   * espiar outra conversa — ou, pior, sobraria no campo da errada.
   *
   * `Map` mutável de propósito: escrever a cada tecla num `useState` re-renderia
   * a árvore inteira do chat por caractere.
   */
  const [drafts] = useState(() => new Map<string, string>());

  const {
    conversations: allConversations,
    promotedConversationCount,
    lastPromotion,
    archivedCount,
    loading,
    updateConversation,
    addConversation,
    markAsRead,
    removeConversation,
  } = useConversations({ box: boxOf(filters), search });

  const tagsController = useConversationTags();

  /**
   * Os filtros são aplicados AQUI, sobre a lista já carregada — não no servidor.
   *
   * Trocar de chip passa a custar zero rede (antes, cada `IA`/`Humano` refazia a
   * consulta inteira), e o Realtime acerta de graça: a conversa que muda de
   * responsável, que recebe mensagem ou que é marcada como lida chega pelo canal
   * que já existe, e este `useMemo` a recoloca no lugar certo.
   *
   * Ver `chat-filters.ts` para quando isto precisa virar filtro de query.
   */
  const conversations = useMemo(
    () =>
      allConversations.filter((conversation) =>
        matchesChatFilters(conversation, filters, tagsController.tagsByConversation)
      ),
    [allConversations, filters, tagsController.tagsByConversation]
  );

  const {
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
  } = useMessages({
    onConversationUpdate: updateConversation,
    onNewConversation: addConversation,
  });

  const closeConversation = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    selectConversation(null);
    // Fechar pelo teclado (Esc) não pode largar o foco no `<body>`: o próximo
    // Tab recomeçaria do topo do documento. O campo de contatos é o destino
    // natural — é de lá que se escolhe a próxima conversa.
    //
    // ⚠️ Só no desktop. No celular a mesma linha abriria o teclado virtual
    // por cima da lista que o operador acabou de pedir para ver.
    if (!isNarrow) setFocusContacts((n) => n + 1);
  }, [selectConversation, isNarrow]);

  const handleSelect = (id: string) => {
    selectConversation(id);
    markAsRead(id);
    // A busca é da conversa anterior; deixar aberta mostraria resultados de
    // outro contato sob o cabeçalho deste.
    setSearchOpen(false);
  };

  /**
   * Cmd/Ctrl+F busca **na conversa aberta**; sem conversa, vai para o campo de
   * contatos. Cmd/Ctrl+Shift+F vai sempre para os contatos — é o caminho de
   * quem quer trocar de conversa sem largar o teclado.
   *
   * Substituir o "localizar" do navegador é o que Slack, Discord e o próprio
   * WhatsApp Web fazem: aqui a conversa tem 684 mensagens e só 100 estão no
   * DOM, então o localizar nativo procuraria no lugar errado de qualquer jeito.
   * Vale só dentro do chat — o listener morre com a tela.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "f" && event.key !== "F") return;
      if (!event.metaKey && !event.ctrlKey) return;
      // Diálogo aberto (editar, encaminhar, enviar anexo) fica com o atalho: o
      // foco está preso lá dentro, então o alvo do evento revela isso. Sem esta
      // guarda o Cmd+F abriria a busca ATRÁS do diálogo, invisível.
      // `data-slot` é nosso (`components/ui/dialog.tsx`) e está sempre lá; o
      // `role` quem escolhe é o Base UI.
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-slot='dialog-content'],[role='dialog']")) return;
      event.preventDefault();

      if (event.shiftKey || !selectedConversationId) {
        setFocusContacts((n) => n + 1);
        return;
      }
      setSearchOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedConversationId]);

  // Deep-link por telefone (?phone=...) ou de um Number Check (?conversation=...).
  // Seleciona a conversa indicada diretamente ou, após o carregamento, a que
  // casa com o telefone. O ref evita re-selecionar em re-renders e não briga
  // com a seleção manual do usuário depois.
  const searchParams = useSearchParams();
  const phoneParam = searchParams.get("phone");
  const conversationParam = searchParams.get("conversation");
  const deepLinkHandled = useRef<string | null>(null);

  useEffect(() => {
    if (conversationParam) {
      const key = `conversation:${conversationParam}`;
      if (deepLinkHandled.current === key) return;
      deepLinkHandled.current = key;
      selectConversation(conversationParam);
      markAsRead(conversationParam);
      return;
    }

    if (!phoneParam || loading) return;
    const key = `phone:${phoneParam}`;
    if (deepLinkHandled.current === key) return;
    // Só tentamos após o primeiro carregamento concluir; marca como tratado
    // para nunca reagir de novo (nem a novas conversas, nem a re-renders).
    deepLinkHandled.current = key;
    const target = conversations.find((c) =>
      phonesMatch(phoneParam, c.contact_phone ?? c.external_id ?? "")
    );
    if (target) {
      selectConversation(target.id);
      markAsRead(target.id);
    } else {
      toast.info("Nenhuma conversa encontrada para este contato ainda.");
    }
  }, [
    conversationParam,
    phoneParam,
    loading,
    conversations,
    selectConversation,
    markAsRead,
  ]);

  const handleTakeover = async () => {
    if (!currentConversation) return;
    setTakeoverLoading(true);
    const next = currentConversation.status === "human" ? "bot" : "human";
    await setConversationStatus(next);
    setTakeoverLoading(false);
  };

  // A conversa que uma rota devolveu: a lista E o cabeçalho, o mesmo par das
  // ações da lista abaixo.
  const handleConversationUpdate = (updated: Partial<ChatConversation> & { id: string }) => {
    updateConversation(updated);
    applyConversationUpdate(updated);
  };

  const handleConversationAction = async (
    conversation: (typeof conversations)[number],
    action: ConversationAction
  ) => {
    try {
      const unreadAction = conversation.unread_count > 0 ? "mark-read" : "mark-unread";
      const archiveAction = conversation.archived_at ? "unarchive" : "archive";
      const pinAction = conversation.pinned_at ? "unpin" : "pin";
      const request =
        action === "delete"
          ? { method: "DELETE" }
          : action === "clear"
            ? { method: "DELETE", suffix: "?mode=clear" }
            : {
                method: "PATCH",
                body:
                  action === "toggle-archive"
                    ? { action: archiveAction }
                    : action === "toggle-pin"
                      ? { action: pinAction }
                      : { action: unreadAction },
              };

      const response = await fetch(
        `/api/chat/conversations/${conversation.id}${request.suffix ?? ""}`,
        {
          method: request.method,
          headers: request.body ? { "Content-Type": "application/json" } : undefined,
          body: request.body ? JSON.stringify(request.body) : undefined,
        }
      );
      const json = (await response.json().catch(() => ({}))) as {
        conversation?: (typeof conversations)[number];
        error?: string;
      };
      if (!response.ok) {
        // Conversa com ticket não se limpa (409): o operador lê o porquê da
        // rota, não um "não foi possível" que convida a tentar de novo.
        if (action === "clear" && response.status === 409 && json.error) {
          toast.error(json.error);
          return false;
        }
        throw new Error(json.error ?? "action failed");
      }

      if (action === "delete") {
        removeConversation(conversation.id);
        if (selectedConversationId === conversation.id) closeConversation();
        toast.success("Conversa removida da lista.");
        return true;
      }

      if (json.conversation) {
        updateConversation(json.conversation);
        applyConversationUpdate(json.conversation);
      }

      if (action === "clear") {
        clearConversationMessages(conversation.id);
        toast.success("Conversa limpa.");
      } else if (action === "toggle-archive") {
        toast.success(archiveAction === "archive" ? "Conversa arquivada." : "Conversa desarquivada.");
      } else if (action === "toggle-pin") {
        toast.success(pinAction === "pin" ? "Conversa fixada." : "Conversa desafixada.");
      } else {
        toast.success(unreadAction === "mark-read" ? "Conversa marcada como lida." : "Conversa marcada como não lida.");
      }
      return true;
    } catch {
      toast.error("Não foi possível atualizar a conversa.");
      return false;
    }
  };

  const mobileShowChat = !!selectedConversationId && !!currentConversation;
  const mobileViewportRef = useRef<HTMLElement>(null);
  // A viewport visual é aplicada só ao painel da conversa e apenas enquanto
  // há teclado real. A lista e a casca nunca recebem geometria transitória.
  useViewportHeight(isNarrow && mobileShowChat, mobileViewportRef);

  /**
   * Gesto de voltar do celular devolve a LISTA, não sai do chat.
   *
   * A conversa aberta é **estado**, não URL — não há entrada no histórico para
   * o gesto consumir, então arrastar da borda (ou o botão voltar do Android)
   * saía de `/app/chat` inteiro e caía no dashboard. Quem vem do WhatsApp
   * espera voltar para a lista.
   *
   * A entrada é empilhada ao ABRIR a conversa e consumida de duas formas — o
   * gesto (`popstate`) e a seta do cabeçalho, que chama `history.back()` em vez
   * de limpar o estado na mão. Se a seta apenas limpasse, a entrada empilhada
   * ficaria órfã e o próximo gesto de voltar não faria nada visível.
   *
   * `1023.98px` é o `lg` do Tailwind: acima disso a lista e a conversa
   * convivem na tela e não existe "voltar" nenhum a fazer.
   */
  const historyPushed = useRef(false);

  useEffect(() => {
    // Depende de `selectedConversationId`, não de `mobileShowChat`: este último
    // é falso enquanto a conversa carrega, e empilharia/desempilharia à toa.
    if (!isNarrow || !selectedConversationId) return;

    // ⚠️ UMA entrada por sessão de conversa, não por conversa. Trocar de A para
    // B empilharia a segunda, e ela ficaria órfã: o operador apertaria voltar
    // na lista e nada aconteceria, precisando de dois toques para sair.
    if (!historyPushed.current) {
      window.history.pushState({ chatConversation: true }, "");
      historyPushed.current = true;
    }

    const onPopState = () => {
      historyPushed.current = false;
      closeConversation();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isNarrow, selectedConversationId, closeConversation]);

  const handleBack = () => {
    // Devolve a entrada ao histórico em vez de deixá-la órfã. O `popstate`
    // resultante é quem limpa a conversa.
    if (historyPushed.current) {
      window.history.back();
      return;
    }
    closeConversation();
  };

  return (
    <div
      className={cn(
        "wa-surface flex h-full overflow-hidden bg-background",
        mobileShowChat && "chat-mobile-overlay"
      )}
    >
      {/* Sidebar */}
      <aside
        className={cn(
          "flex h-full w-full shrink-0 flex-col border-r border-[var(--wa-panel-border)] lg:w-[360px] xl:w-[400px]",
          mobileShowChat && "hidden lg:flex"
        )}
      >
        <ConversationsList
          conversations={conversations}
          promotedConversationCount={promotedConversationCount}
          lastPromotion={lastPromotion}
          loading={loading}
          selectedId={selectedConversationId}
          onSelect={handleSelect}
          onSearchChange={setSearch}
          focusSearchToken={focusContacts}
          filters={filters}
          onFiltersChange={setFilters}
          onConversationAction={handleConversationAction}
          tagsController={tagsController}
          archivedCount={archivedCount}
        />
      </aside>

      {/* Chat area */}
      <main
        ref={mobileViewportRef}
        className={cn(
          "chat-mobile-viewport flex min-w-0 flex-1 flex-col",
          !mobileShowChat && "hidden lg:flex"
        )}
      >
        {currentConversation ? (
          <ChatView
            conversation={currentConversation}
            messages={messages}
            messagesLoading={messagesLoading}
            hasMore={hasMoreMessages}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlderMessages}
            onLoadAround={loadAroundMessage}
            windowed={windowed}
            onReloadLatest={reloadLatest}
            drafts={drafts}
            onBack={handleBack}
            onSend={sendMessage}
            onRetryMessage={retrySendMessage}
            onSendAudio={sendAudio}
            onSendFile={sendFile}
            onSendNote={sendNote}
            onEditMessage={editMessage}
            onDeleteMessage={deleteMessage}
            onForwardMessages={forwardMessages}
            // Destinos do encaminhamento: a mesma lista da barra lateral, já
            // carregada. Buscar de novo no servidor seria uma segunda fonte da
            // verdade para o mesmo dado.
            conversations={conversations}
            searchOpen={searchOpen}
            onSearchOpenChange={setSearchOpen}
            onTakeover={handleTakeover}
            takeoverLoading={takeoverLoading}
            onConversationUpdate={handleConversationUpdate}
            tagsController={tagsController}
          />
        ) : (
          <ChatEmpty />
        )}
      </main>
    </div>
  );
}

function ChatEmpty() {
  return (
    <div className="wa-surface flex h-full flex-col items-center justify-center gap-5 bg-[var(--wa-bg)] text-center">
      <div className="flex size-24 items-center justify-center rounded-full bg-[var(--wa-green)]/10">
        <WhatsAppIcon className="size-12" brand />
      </div>
      <div className="max-w-sm space-y-2 px-6">
        <h3 className="text-xl font-light text-foreground">Atendimento ao vivo</h3>
        <p className="text-sm text-[var(--wa-meta)]">
          Selecione uma conversa à esquerda para visualizar o histórico e
          responder pelo WhatsApp em tempo real.
        </p>
      </div>
    </div>
  );
}
