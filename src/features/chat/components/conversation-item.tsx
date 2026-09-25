"use client";

import { memo, useEffect, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckCheck,
  FileText,
  ImageIcon,
  MailIcon,
  MailOpenIcon,
  MessagesSquareIcon,
  Mic,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  Video,
} from "lucide-react";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  ConversationActionsDropdown,
  type ConversationAction,
} from "@/features/chat/components/conversation-actions";
import { ContactAvatar } from "@/features/chat/components/contact-avatar";
import { ConversationTagChips } from "@/features/chat/components/conversation-tag-chips";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import {
  cancelsConversationLongPress,
  clampConversationSwipe,
  CONVERSATION_LONG_PRESS_MS,
  CONVERSATION_SWIPE_ACTION_WIDTH,
  conversationSwipeMoved,
  conversationSwipeOffset,
  detectConversationSwipeAxis,
  settleConversationSwipe,
  type SwipeAxis,
  type SwipeSide,
} from "@/features/chat/lib/conversation-swipe";
import { stripWhatsappFormat } from "@/features/chat/lib/whatsapp-format";
import type { ChatConversation } from "@/features/chat/types";
import type { Tag } from "@/features/tags/types";

type ConversationItemProps = {
  conversation: ChatConversation;
  /**
   * ⚠️ Precisa vir com referência ESTÁVEL enquanto as etiquetas não mudam —
   * senão o `memo` abaixo morre e o arraste volta a engasgar. Quem garante isso
   * é `mergeTagAssignment`, devolvendo o mesmo array para quem não mudou.
   */
  tags: readonly Tag[];
  isSelected: boolean;
  /** Qual faixa está aberta nesta linha, se alguma. */
  swipeSide: SwipeSide;
  onSelect: (id: string) => void;
  onSwipeOpen: (id: string, side: Exclude<SwipeSide, null>) => void;
  onSwipeClose: () => void;
  onOpenActions: (conversation: ChatConversation) => void;
  onRequestAction: (conversation: ChatConversation, action: ConversationAction) => void;
  onOpenTags: (conversation: ChatConversation) => void;
};

function formatPreviewDate(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ontem";
    if (differenceInDays(new Date(), d) < 7) return format(d, "EEE", { locale: ptBR });
    return format(d, "dd/MM/yyyy");
  } catch {
    return "";
  }
}

function getPreviewIcon(preview: string | null) {
  if (!preview) return null;
  const cls = "size-3.5 shrink-0";
  if (preview.startsWith("[audio]")) return <Mic className={cls} />;
  if (preview.startsWith("[video]")) return <Video className={cls} />;
  if (preview.startsWith("[image]") || preview.startsWith("[sticker]"))
    return <ImageIcon className={cls} />;
  if (preview.startsWith("[document]") || preview.startsWith("[arquivo]"))
    return <FileText className={cls} />;
  return null;
}

// Rótulo p/ mídia sem legenda (ex.: "[audio]" → "Áudio") — evita "Sem mensagens".
const MEDIA_LABELS: Record<string, string> = {
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
  document: "Documento",
  arquivo: "Arquivo",
  sticker: "Figurinha",
  contact: "Contato",
};
function mediaLabel(preview: string | null): string {
  const m = preview?.match(/^\[(.+?)\]/);
  return m ? MEDIA_LABELS[m[1]] ?? "" : "";
}

/**
 * Linha da lista de conversas.
 *
 * ⚠️ **`memo` não é enfeite.** São 348 conversas em produção; sem ele, cada
 * `setSwipedId` no meio do arraste re-renderizava a lista inteira e o gesto
 * engasgava. Depende de os handlers virem estáveis de `conversations-list.tsx`.
 */
export const ConversationItem = memo(function ConversationItem({
  conversation,
  tags,
  isSelected,
  swipeSide,
  onSelect,
  onSwipeOpen,
  onSwipeClose,
  onOpenActions,
  onRequestAction,
  onOpenTags,
}: ConversationItemProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  // `offset` é o ponto de partida do arraste. `x`/`y` são reancorados quando o
  // eixo é reconhecido, para a linha não pular os pixels do limiar.
  const touchStart = useRef({ x: 0, y: 0, offset: 0 });
  const swipeAxis = useRef<SwipeAxis>("pending");
  const longPress = useRef<{ timer: number; abort: AbortController } | null>(null);
  const longPressFired = useRef(false);
  const suppressClickUntil = useRef(0);

  const restingOffset = conversationSwipeOffset(swipeSide);
  const swipeOpen = swipeSide !== null;
  const dragging = dragOffset !== null;
  const offset = dragOffset ?? restingOffset;
  // Só a faixa do lado para onde o dedo foi é montada. Montar as duas em
  // todas as linhas custava ~700 botões parados no DOM do celular, e era
  // metade da lentidão do arraste antes de a montagem virar condicional.
  const showTrailing = swipeSide === "trailing" || (dragging && offset < 0);
  const showLeading = swipeSide === "leading" || (dragging && offset > 0);

  const stopLongPress = () => {
    if (!longPress.current) return;
    window.clearTimeout(longPress.current.timer);
    longPress.current.abort.abort();
    longPress.current = null;
  };

  const startLongPress = () => {
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      longPress.current = null;
      abort.abort();
      longPressFired.current = true;
      // 700 ms cobre o clique fantasma que o navegador dispara depois do
      // `touchend` — sem isso a gaveta abria e fechava no mesmo gesto.
      suppressClickUntil.current = Date.now() + 700;
      setDragOffset(null);
      navigator.vibrate?.(10);
      onOpenActions(conversation);
    }, CONVERSATION_LONG_PRESS_MS);

    longPress.current = { timer, abort };
    // Rolar a lista mata o toque longo: encostar o dedo para segurar a inércia
    // não pode virar menu. `capture` porque `scroll` não borbulha, e o `signal`
    // é o que garante a remoção sem precisar guardar a referência do handler.
    window.addEventListener("scroll", stopLongPress, { capture: true, signal: abort.signal });
  };

  useEffect(() => stopLongPress, []);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, offset: restingOffset };
    swipeAxis.current = "pending";
    longPressFired.current = false;
    // Nada de `setState` aqui: um toque que termina em clique não pode custar
    // dois renders da linha antes de a conversa abrir.
    if (!swipeOpen) startLongPress();
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || longPressFired.current) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;

    if (cancelsConversationLongPress(deltaX, deltaY)) stopLongPress();

    if (swipeAxis.current === "pending") {
      swipeAxis.current = detectConversationSwipeAxis(deltaX, deltaY);
      // Reancora no ponto em que o eixo foi reconhecido; sem isso a linha
      // saltaria os pixels do limiar no primeiro quadro do arraste.
      if (swipeAxis.current === "horizontal") {
        touchStart.current.x = touch.clientX;
        touchStart.current.y = touch.clientY;
      }
    }
    if (swipeAxis.current !== "horizontal") return;

    setDragOffset(
      clampConversationSwipe(
        touchStart.current.offset + touch.clientX - touchStart.current.x
      )
    );
  };

  const finishTouch = (event: TouchEvent<HTMLDivElement>) => {
    stopLongPress();
    if (longPressFired.current) return;

    if (swipeAxis.current === "horizontal") {
      const touch = event.changedTouches.item(0);
      const finalOffset = touch
        ? clampConversationSwipe(
            touchStart.current.offset + touch.clientX - touchStart.current.x
          )
        : offset;
      const side = settleConversationSwipe(finalOffset);
      if (side) onSwipeOpen(conversation.id, side);
      else onSwipeClose();
      if (conversationSwipeMoved(touchStart.current.offset, finalOffset)) {
        suppressClickUntil.current = Date.now() + 400;
      }
    }
    if (dragging) setDragOffset(null);
    swipeAxis.current = "pending";
  };

  const cancelTouch = () => {
    stopLongPress();
    if (dragging) setDragOffset(null);
    swipeAxis.current = "pending";
  };

  const displayName =
    conversation.contact_name || conversation.contact_phone || "Contato desconhecido";

  const preview = conversation.last_message_preview;
  const icon = getPreviewIcon(preview);
  // Tira o marcador de mídia e a formatação do WhatsApp: a prévia mostrava
  // `*Carla:* Oi...` cru, com asterisco, enquanto a bolha já renderizava certo.
  const cleanPreview = stripWhatsappFormat(preview?.replace(/^\[.*?\]\s*/, "") ?? "").replace(
    /\s+/g,
    " "
  );
  const unread = conversation.unread_count > 0;

  return (
    <div
      // A lista mede as linhas por estes atributos. `data-conversation-row`
      // separa conversa de atalho (arquivadas, etiquetas), que moram no mesmo
      // contêiner rolável; o id permite compensar pela altura da linha que
      // realmente entrou, agora que etiqueta faz alturas diferentes.
      data-conversation-row=""
      data-conversation-id={conversation.id}
      className="group/conversation relative overflow-hidden"
      role="presentation"
    >
      {/*
        Só existe durante o gesto e enquanto a linha está aberta. Montar as duas
        faixas em todas as conversas custava ~700 botões e ícones parados no DOM
        do celular sem ninguém para vê-los.
      */}
      {/* Faixa da DIREITA — arrastar para a esquerda. */}
      {showTrailing ? (
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex lg:hidden",
            swipeSide !== "trailing" && "pointer-events-none"
          )}
          aria-hidden={swipeSide !== "trailing"}
        >
          <SwipeAction
            active={swipeSide === "trailing"}
            onClick={() => {
              onSwipeClose();
              onOpenActions(conversation);
            }}
            className="bg-zinc-500"
            label={`Mais opções de ${displayName}`}
            icon={<MoreHorizontalIcon className="size-6" />}
          >
            Mais
          </SwipeAction>
          <SwipeAction
            active={swipeSide === "trailing"}
            onClick={() => {
              onSwipeClose();
              onRequestAction(conversation, "toggle-archive");
            }}
            className="bg-[var(--wa-green-deep)]"
            label={conversation.archived_at ? "Desarquivar conversa" : "Arquivar conversa"}
            icon={
              conversation.archived_at ? (
                <ArchiveRestoreIcon className="size-6" />
              ) : (
                <ArchiveIcon className="size-6" />
              )
            }
          >
            {conversation.archived_at ? "Desarquivar" : "Arquivar"}
          </SwipeAction>
        </div>
      ) : null}

      {/* Faixa da ESQUERDA — arrastar para a direita, como no iOS. A ordem é a
          da referência: "Não lida" na ponta e "Fixar" encostado na linha. */}
      {showLeading ? (
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex lg:hidden",
            swipeSide !== "leading" && "pointer-events-none"
          )}
          aria-hidden={swipeSide !== "leading"}
        >
          <SwipeAction
            active={swipeSide === "leading"}
            onClick={() => {
              onSwipeClose();
              onRequestAction(conversation, "toggle-unread");
            }}
            className="bg-[var(--wa-green-deep)]"
            label={unread ? "Marcar como lida" : "Marcar como não lida"}
            icon={
              unread ? <MailOpenIcon className="size-6" /> : <MailIcon className="size-6" />
            }
          >
            {unread ? "Lida" : "Não lida"}
          </SwipeAction>
          <SwipeAction
            active={swipeSide === "leading"}
            onClick={() => {
              onSwipeClose();
              onRequestAction(conversation, "toggle-pin");
            }}
            className="bg-zinc-500"
            label={conversation.pinned_at ? "Desafixar conversa" : "Fixar conversa"}
            icon={
              conversation.pinned_at ? (
                <PinOffIcon className="size-6" />
              ) : (
                <PinIcon className="size-6" />
              )
            }
          >
            {conversation.pinned_at ? "Desafixar" : "Fixar"}
          </SwipeAction>
        </div>
      ) : null}

      {/*
        ⚠️ Quem desliza é ESTA camada, não o botão de dentro.
        Ela é `z-10` e tem a largura toda: parada, cobre as duas ações e engole o
        toque destinado a "Mais"/"Arquivar". Transladando ela, o lado direito
        fica realmente descoberto e os botões recebem o dedo.
      */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={finishTouch}
        onTouchCancel={cancelTouch}
        className={cn(
          "relative z-10 [touch-action:pan-y]",
          // `will-change` só durante o arraste. Fixo, promovia uma camada de
          // composição por linha — 348 delas — e era metade da lentidão.
          dragging
            ? "transition-none will-change-transform"
            : "transition-transform duration-200 ease-out",
          // Linha fechada não ganha `transform` nenhum: sem contexto de
          // empilhamento e sem bloco de contenção onde não há o que deslocar.
          (swipeOpen || dragging) &&
            "translate-x-[var(--conversation-swipe-x)] lg:translate-x-0"
        )}
        style={{ "--conversation-swipe-x": `${offset}px` } as CSSProperties}
      >
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          onClick={() => {
            if (Date.now() < suppressClickUntil.current) return;
            if (swipeOpen) {
              onSwipeClose();
              return;
            }
            onSelect(conversation.id);
          }}
          className={cn(
            "flex w-full items-center gap-3 bg-background px-3 py-2.5 text-left transition-colors duration-200 ease-out",
            isSelected
              ? "bg-black/5 dark:bg-white/10"
              : "hover:bg-black/[0.03] dark:hover:bg-white/5"
          )}
        >
          {/* Avatar */}
          <div className="relative shrink-0">
            <ContactAvatar
              name={conversation.contact_name}
              phone={conversation.contact_phone}
              url={conversation.contact_avatar_url}
            />
            {/* WhatsApp source badge */}
            <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-background ring-2 ring-background">
              <WhatsAppIcon className="size-4" brand />
            </span>
          </div>

          {/*
            `lg:pr-8` é a calha reservada para o gatilho ⋯ do desktop. Sem ela o
            botão de 32 px nascia por cima do horário e do balão de não lidas.
            Vai nas duas linhas, e não no bloco: o `border-b` é o divisor da
            lista e precisa continuar indo até a borda.
          */}
          <div className="-mb-2.5 min-w-0 flex-1 border-b border-[var(--wa-panel-border)] pb-2.5">
            <div className="flex items-baseline justify-between gap-2 lg:pr-8">
              <span
                className={cn(
                  "truncate text-[15px]",
                  unread ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                )}
              >
                {displayName}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] tabular-nums",
                  unread
                    ? "font-semibold text-[var(--wa-green-deep)]"
                    : "text-[var(--wa-meta)]"
                )}
              >
                {formatPreviewDate(conversation.last_message_at)}
              </span>
            </div>

            <div className="mt-0.5 flex items-center justify-between gap-2 lg:pr-8">
              <div className="flex min-w-0 items-center gap-1 text-[var(--wa-meta)]">
                {icon}
                <p className={cn("truncate text-[13px]", unread && "text-foreground/70")}>
                  {cleanPreview || mediaLabel(preview) || "Sem mensagens"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {conversation.status === "bot" && (
                  <MessagesSquareIcon
                    className="size-3.5 text-[var(--wa-meta)]"
                    aria-label="IA"
                  />
                )}
                {conversation.status === "resolved" && (
                  <CheckCheck
                    className="size-3.5 text-[var(--wa-meta)]"
                    aria-label="Resolvido"
                  />
                )}
                {/* Alfinete da fixada, como no WhatsApp. Sem ele, a conversa
                    aparece no topo sem explicação e parece defeito de ordem. */}
                {conversation.pinned_at && (
                  <PinIcon
                    className="size-3.5 text-[var(--wa-meta)]"
                    aria-label="Conversa fixada"
                  />
                )}
                {unread && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--wa-green)] px-1.5 text-[11px] font-bold text-white">
                    {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
                  </span>
                )}
              </div>
            </div>

            {/* Terceira linha, como no WhatsApp Business. Só existe quando há
                etiqueta — e é por isso que a lista deixou de ter altura
                uniforme; a compensação de scroll mede as linhas de verdade
                (`measureConversationRows`). */}
            <ConversationTagChips tags={tags} className="mt-1.5 lg:pr-8" />
          </div>
        </button>

        <ConversationActionsDropdown
          conversation={conversation}
          onRequest={onRequestAction}
          onOpenTags={onOpenTags}
        />
      </div>
    </div>
  );
});

/**
 * Botão de uma faixa lateral. As duas faixas usam o mesmo, para largura, tipo e
 * alvo de foco não divergirem entre o lado que já existia e o novo.
 */
function SwipeAction({
  active,
  onClick,
  className,
  label,
  icon,
  children,
}: {
  /** A faixa está aberta? Fechada, o botão sai da ordem de tabulação. */
  active: boolean;
  onClick: () => void;
  className: string;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex flex-col items-center justify-center gap-1 text-xs font-medium text-white",
        className
      )}
      style={{ width: CONVERSATION_SWIPE_ACTION_WIDTH }}
    >
      {icon}
      {children}
    </button>
  );
}
