"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronLeftIcon,
  MailIcon,
  MailOpenIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  TagIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContactAvatar } from "@/features/chat/components/contact-avatar";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/features/chat/types";

export type ConversationAction =
  | "toggle-archive"
  | "toggle-unread"
  | "toggle-pin"
  | "clear"
  | "delete";

type RequestAction = (conversation: ChatConversation, action: ConversationAction) => void;

function archiveLabel(conversation: ChatConversation) {
  return conversation.archived_at ? "Desarquivar conversa" : "Arquivar conversa";
}

function pinLabel(conversation: ChatConversation) {
  return conversation.pinned_at ? "Desafixar conversa" : "Fixar conversa";
}

function PinActionIcon({ conversation }: { conversation: ChatConversation }) {
  return conversation.pinned_at ? <PinOffIcon /> : <PinIcon />;
}

function unreadLabel(conversation: ChatConversation) {
  return conversation.unread_count > 0 ? "Marcar como lida" : "Marcar como não lida";
}

function ArchiveActionIcon({ conversation }: { conversation: ChatConversation }) {
  return conversation.archived_at ? <ArchiveRestoreIcon /> : <ArchiveIcon />;
}

function UnreadActionIcon({ conversation }: { conversation: ChatConversation }) {
  return conversation.unread_count > 0 ? <MailOpenIcon /> : <MailIcon />;
}

export function ConversationActionsDropdown({
  conversation,
  onRequest,
  onOpenTags,
}: {
  conversation: ChatConversation;
  onRequest: RequestAction;
  onOpenTags: (conversation: ChatConversation) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Mais opções de ${conversation.contact_name || conversation.contact_phone || "contato"}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          // A linha reserva `lg:pr-8` para este botão (ver conversation-item):
          // ele não passa por cima do horário nem do balão de não lidas, então
          // não precisa de fundo opaco nem de sombra para se destacar. Sombra
          // aqui significaria sobreposição, e não há mais nenhuma (UI.md §3.3).
          "absolute right-2 top-1/2 z-20 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full",
          "text-[var(--wa-meta)] transition",
          "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "lg:flex",
          // Invisível é inerte (UI.md §5.7.3). `data-popup-open` mantém o botão
          // aceso enquanto o próprio menu está aberto — sem ele, levar o mouse
          // até o menu tirava o hover da linha e o gatilho sumia por baixo.
          "pointer-events-none opacity-0",
          "lg:group-hover/conversation:pointer-events-auto lg:group-hover/conversation:opacity-100",
          "focus-visible:pointer-events-auto focus-visible:opacity-100",
          "data-[popup-open]:pointer-events-auto data-[popup-open]:opacity-100"
        )}
      >
        <MoreHorizontalIcon className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={-2} className="w-60 p-1.5">
        <DropdownMenuItem
          className="min-h-9 gap-3 px-3"
          onClick={() => onOpenTags(conversation)}
        >
          <TagIcon />
          Etiquetas
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-9 gap-3 px-3"
          onClick={() => onRequest(conversation, "toggle-pin")}
        >
          <PinActionIcon conversation={conversation} />
          {pinLabel(conversation)}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-9 gap-3 px-3"
          onClick={() => onRequest(conversation, "toggle-archive")}
        >
          <ArchiveActionIcon conversation={conversation} />
          {archiveLabel(conversation)}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-9 gap-3 px-3"
          onClick={() => onRequest(conversation, "toggle-unread")}
        >
          <UnreadActionIcon conversation={conversation} />
          {unreadLabel(conversation)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-9 gap-3 px-3"
          onClick={() => onRequest(conversation, "clear")}
        >
          <XCircleIcon />
          Limpar conversa
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-9 gap-3 px-3"
          onClick={() => onRequest(conversation, "delete")}
        >
          <Trash2Icon />
          Remover da lista
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConversationActionsDrawer({
  conversation,
  open,
  view,
  onOpenChange,
  onRequest,
  onOpenTags,
  onBackToActions,
  tagsContent,
}: {
  conversation: ChatConversation;
  open: boolean;
  /** `tags` troca o miolo da MESMA gaveta — nunca abre uma segunda camada. */
  view: "actions" | "tags";
  onOpenChange: (open: boolean) => void;
  onRequest: RequestAction;
  onOpenTags: () => void;
  onBackToActions: () => void;
  tagsContent: React.ReactNode;
}) {
  const displayName =
    conversation.contact_name || conversation.contact_phone || "Contato desconhecido";
  const taggingView = view === "tags";

  const request = (action: ConversationAction) => {
    onOpenChange(false);
    onRequest(conversation, action);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        showHandle
        className="wa-surface max-h-[88dvh] gap-0 overflow-hidden bg-background p-0"
      >
        <DrawerTitle className="sr-only">
          {taggingView
            ? `Etiquetas da conversa com ${displayName}`
            : `Opções da conversa com ${displayName}`}
        </DrawerTitle>
        <DrawerClose
          className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Fechar"
        >
          <XIcon className="size-5" />
        </DrawerClose>

        {taggingView ? (
          <div className="flex items-center gap-1 px-2 pb-3 pt-3 pr-16">
            <button
              type="button"
              onClick={onBackToActions}
              aria-label="Voltar para as opções da conversa"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-meta)] transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
            <p className="min-w-0 truncate text-base font-semibold text-foreground">
              Etiquetas
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-5 pb-4 pt-3 pr-16">
            <ContactAvatar
              name={conversation.contact_name}
              phone={conversation.contact_phone}
              url={conversation.contact_avatar_url}
              className="size-12"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">{displayName}</p>
              {conversation.contact_phone ? (
                <p className="truncate text-sm text-[var(--wa-meta)]">
                  {conversation.contact_phone}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {taggingView ? (
          <div className="mx-3 mb-3 overflow-hidden rounded-2xl bg-[var(--wa-panel)] ring-1 ring-[var(--wa-panel-border)]">
            {tagsContent}
          </div>
        ) : (
          <>
            <div className="mx-3 mb-3 divide-y divide-[var(--wa-panel-border)] overflow-hidden rounded-2xl bg-[var(--wa-panel)] ring-1 ring-[var(--wa-panel-border)]">
              <DrawerAction onClick={onOpenTags}>
                <TagIcon />
                Etiquetas
              </DrawerAction>
              <DrawerAction onClick={() => request("toggle-pin")}>
                <PinActionIcon conversation={conversation} />
                {pinLabel(conversation)}
              </DrawerAction>
              <DrawerAction onClick={() => request("toggle-archive")}>
                <ArchiveActionIcon conversation={conversation} />
                {archiveLabel(conversation)}
              </DrawerAction>
              <DrawerAction onClick={() => request("toggle-unread")}>
                <UnreadActionIcon conversation={conversation} />
                {unreadLabel(conversation)}
              </DrawerAction>
              <DrawerAction onClick={() => request("clear")}>
                <XCircleIcon />
                Limpar conversa
              </DrawerAction>
            </div>

            <div className="mx-3 mb-3 overflow-hidden rounded-2xl bg-[var(--wa-panel)] ring-1 ring-[var(--wa-panel-border)]">
              <DrawerAction onClick={() => request("delete")}>
                <Trash2Icon />
                Remover da lista
              </DrawerAction>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerAction({
  children,
  destructive = false,
  onClick,
}: {
  children: React.ReactNode;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full items-center gap-4 px-4 text-left text-[16px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        destructive
          ? "text-destructive active:bg-destructive/10"
          : "text-foreground active:bg-black/5 dark:active:bg-white/10",
        "[&_svg]:size-[22px] [&_svg]:shrink-0 [&_svg]:stroke-[1.8]"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Etiquetas a partir do menu ⋯ do desktop.
 *
 * Diálogo próprio, e não a gaveta: o dropdown do Base UI **não é modal** — ele
 * fecha ao escolher o item, então abrir um diálogo em seguida não empilha camada
 * nenhuma. E o `Dialog` do repo já vira gaveta sozinho no celular, então a mesma
 * composição serve nas duas larguras sem `if` de breakpoint.
 */
export function ConversationTagsDialog({
  conversation,
  onClose,
  children,
}: {
  conversation: ChatConversation;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const displayName =
    conversation.contact_name || conversation.contact_phone || "Contato desconhecido";

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="wa-surface gap-0 p-0 sm:max-w-sm">
        <DialogHeader className="px-4 pb-2 pt-4 pr-14">
          <DialogTitle className="font-sans text-base">Etiquetas</DialogTitle>
          <DialogDescription className="truncate">{displayName}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function ConversationActionDialog({
  conversation,
  action,
  loading,
  onCancel,
  onConfirm,
}: {
  conversation: ChatConversation;
  action: "clear" | "delete";
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const displayName =
    conversation.contact_name || conversation.contact_phone || "este contato";
  const deleting = action === "delete";

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-sans">{deleting ? "Remover da lista?" : "Limpar conversa?"}</DialogTitle>
          <DialogDescription>
            {deleting
              ? `A conversa com ${displayName} sairá da lista, mas a pessoa, as mensagens e o histórico serão preservados. Se o contato voltar, a conversa reaparecerá com o mesmo contexto.`
              : `Todas as mensagens da conversa com ${displayName} serão removidas deste CRM. A conversa continuará na lista. Não dá para desfazer.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant={deleting ? "default" : "destructive"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Aguarde…" : deleting ? "Remover" : "Limpar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
