"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CircleEllipsisIcon,
  CopyIcon,
  ForwardIcon,
  PencilIcon,
  ReplyIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MessageBubble } from "@/features/chat/components/message-bubble";
import {
  canDeleteMessage,
  canEditMessage,
  canForwardMessage,
} from "@/features/chat/lib/message-actions";
import {
  getMessageContextLayout,
  MESSAGE_CONTEXT_EDGE,
  MESSAGE_CONTEXT_GAP,
  type AnchorRect,
} from "@/features/chat/lib/message-context-layout";
import { stripWhatsappFormat } from "@/features/chat/lib/whatsapp-format";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/features/chat/types";

export type { AnchorRect } from "@/features/chat/lib/message-context-layout";

const ITEM_HEIGHT = 56;
const PANEL_PADDING = 12;
const SEPARATOR_HEIGHT = 1;
/** Carência para o `click` fantasma que o toque longo deixa para trás. */
const GHOST_CLICK_MS = 400;

type Action = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
};

type PendingAction = "reply" | "forward" | "copy" | "edit" | "delete" | "more";

/**
 * Menu de contexto do toque longo, no formato do WhatsApp no celular: o fundo
 * embaça, a mensagem tocada continua nítida e o conjunto sobe quando não cabe
 * abaixo — o painel nunca troca de lado e se separa da mensagem selecionada.
 *
 * **A bolha é um clone, não a original.** A original vive dentro do contêiner
 * que rola; não há z-index que a levante acima de uma camada de tela cheia sem
 * arrastar a lista inteira junto. O clone permite embaçar tudo e manter só a
 * mensagem selecionada em foco.
 *
 * Vai no primitivo `Dialog` pela armadilha de foco, o Esc e a trava de rolagem.
 * O estado `open` fica local para o Base UI terminar a animação de saída antes
 * de o pai desmontar esta composição.
 */
export function MessageContextMenu({
  message,
  quoted,
  anchor,
  openedAt,
  onClose,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onMore,
}: {
  message: ChatMessage;
  quoted: ChatMessage | null;
  anchor: AnchorRect;
  /** Instante do toque longo — carimbado no handler, nunca durante o render. */
  openedAt: number;
  onClose: () => void;
  onReply?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onMore?: (message: ChatMessage) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [canDismiss, setCanDismiss] = useState(false);
  // A altura real só se conhece depois de montar. Começa na estimativa para o
  // conjunto já nascer na posição certa, sem saltar no primeiro frame.
  const [measured, setMeasured] = useState<number | null>(null);

  const close = (action: PendingAction | null = null) => {
    if (!open) return;
    setPendingAction(action);
    setOpen(false);
  };

  /**
   * O toque longo termina em `touchend`, e o navegador ainda dispara um `click`
   * fantasma nas coordenadas do dedo. Sem esta carência, o menu abre e fecha no
   * mesmo gesto.
   */
  const dismiss = () => {
    if (!canDismiss) return;
    close();
  };

  useEffect(() => {
    const elapsed = Date.now() - openedAt;
    const timer = window.setTimeout(
      () => setCanDismiss(true),
      Math.max(0, GHOST_CLICK_MS - elapsed)
    );
    return () => window.clearTimeout(timer);
  }, [openedAt]);

  const copyableText = message.content?.trim() ? message.content : null;
  const actions: Action[] = [];
  if (onReply) {
    actions.push({
      key: "reply",
      label: "Responder",
      icon: <ReplyIcon />,
      onSelect: () => close("reply"),
    });
  }
  if (onForward && canForwardMessage(message)) {
    actions.push({
      key: "forward",
      label: "Encaminhar",
      icon: <ForwardIcon />,
      onSelect: () => close("forward"),
    });
  }
  if (copyableText) {
    actions.push({
      key: "copy",
      label: "Copiar",
      icon: <CopyIcon />,
      onSelect: () => close("copy"),
    });
  }
  // A janela de edição usa o instante do toque, não o relógio de agora: ler a
  // hora durante o render é impuro e o item não pode sumir com o menu aberto.
  if (onEdit && canEditMessage(message, openedAt)) {
    actions.push({
      key: "edit",
      label: "Editar",
      icon: <PencilIcon />,
      onSelect: () => close("edit"),
    });
  }
  if (onDelete && canDeleteMessage(message)) {
    actions.push({
      key: "delete",
      label: "Apagar",
      icon: <Trash2Icon />,
      onSelect: () => close("delete"),
      destructive: true,
    });
  }
  if (onMore) {
    actions.push({
      key: "more",
      label: "Mais…",
      icon: <CircleEllipsisIcon />,
      onSelect: () => close("more"),
      separatorBefore: true,
    });
  }

  const separatorCount = actions.filter((action) => action.separatorBefore).length;
  const estimated =
    actions.length * ITEM_HEIGHT + PANEL_PADDING + separatorCount * SEPARATOR_HEIGHT;
  const panelHeight = measured ?? estimated;

  useLayoutEffect(() => {
    const height = panelRef.current?.scrollHeight;
    if (height) setMeasured(height);
  }, []);

  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const layout = getMessageContextLayout({
    anchor,
    direction: message.direction,
    panelHeight,
    viewportHeight,
    viewportWidth,
  });
  const isOutbound = message.direction === "outbound";
  const preview =
    stripWhatsappFormat(message.content ?? "").replace(/\s+/g, " ").slice(0, 60) ||
    "mensagem";

  return (
    <Dialog
      variant="dialog"
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        onClose();
        if (pendingAction === "reply") onReply?.(message);
        if (pendingAction === "forward") onForward?.(message);
        if (pendingAction === "copy" && copyableText) void copy(copyableText);
        if (pendingAction === "edit") onEdit?.(message);
        if (pendingAction === "delete") onDelete?.(message);
        if (pendingAction === "more") onMore?.(message);
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="wa-context-overlay"
        className={cn(
          "wa-context-dialog wa-surface fixed inset-0 top-0 left-0 block h-dvh w-screen max-w-none",
          "translate-x-0 translate-y-0 gap-0 rounded-none bg-transparent p-0",
          "shadow-none ring-0 sm:max-w-none"
        )}
        onClick={dismiss}
      >
        <DialogTitle className="sr-only">{`Opções da mensagem: ${preview}`}</DialogTitle>

        {/* Mensagem e menu formam um conjunto. Se não houver espaço embaixo, o
            conjunto inteiro sobe, como no iOS; inverter o painel para cima da
            mensagem quebraria a relação visual da referência. */}
        <div
          className="pointer-events-none fixed"
          style={{
            top: `max(calc(env(safe-area-inset-top) + ${MESSAGE_CONTEXT_EDGE}px), ${layout.clusterTop}px)`,
            left: anchor.left,
            width: anchor.width,
          }}
        >
          <div
            aria-hidden
            className={cn(
              "wa-context-message relative overflow-hidden",
              anchor.height > layout.messageHeight && "wa-context-message-clipped"
            )}
            style={{ maxHeight: layout.messageHeight }}
          >
            <MessageBubble message={message} quoted={quoted} showTail />
          </div>

          <div
            ref={panelRef}
            role="menu"
            aria-label="Opções da mensagem"
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "wa-context-panel pointer-events-auto absolute overflow-y-auto overscroll-contain rounded-[20px] py-1.5",
              // ⚠️ Fundo e blur saem do `.wa-context-panel` no `globals.css`, e
              // não de utilitário aqui: o material precisa de `@supports` para
              // cair numa cor quase sólida onde não há `backdrop-filter`, e isso
              // não se escreve em classe do Tailwind. Duas fontes para a mesma
              // propriedade brigariam por ordem no CSS gerado.
              "text-[var(--wa-context-fg)]",
              "shadow-[var(--wa-context-shadow)] ring-1 ring-[var(--wa-context-border)]"
            )}
            style={{
              top: layout.messageHeight + MESSAGE_CONTEXT_GAP,
              left: layout.panelLeft,
              width: layout.panelWidth,
              maxHeight: `min(${layout.panelMaxHeight}px, calc(100dvh - env(safe-area-inset-bottom) - ${layout.clusterTop + layout.messageHeight + MESSAGE_CONTEXT_GAP + MESSAGE_CONTEXT_EDGE}px))`,
              transformOrigin: isOutbound ? "top right" : "top left",
            }}
          >
            {actions.map((action, index) => (
              <Fragment key={action.key}>
                {action.separatorBefore ? (
                  <div
                    role="separator"
                    className="mx-4 h-px bg-[var(--wa-context-divider)]"
                  />
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  autoFocus={index === 0}
                  onClick={action.onSelect}
                  className={cn(
                    "wa-context-action flex w-full items-center gap-[18px] px-[18px] text-[16.5px] leading-none font-normal tracking-[-0.01em]",
                    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wa-context-focus)]",
                    action.destructive
                      ? "text-[var(--wa-context-danger)] active:bg-[var(--wa-context-active)]"
                      : "active:bg-[var(--wa-context-active)]",
                    "[&_svg]:size-[22px] [&_svg]:shrink-0 [&_svg]:stroke-[1.8]"
                  )}
                  style={{
                    height: ITEM_HEIGHT,
                    animationDelay: `${80 + index * 18}ms`,
                  }}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Mensagem copiada.");
  } catch {
    toast.error("Não foi possível copiar.");
  }
}
