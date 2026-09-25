"use client";

import {
  ChevronLeftIcon,
  Loader2Icon,
  MessagesSquareIcon,
  SearchIcon,
  UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/features/chat/components/contact-avatar";
import { contactDisplayName } from "@/features/chat/lib/contact-info";
import { formatPhoneBR } from "@/lib/formatters/phone";
import type { ChatConversation } from "@/features/chat/types";

type ChatHeaderProps = {
  conversation: ChatConversation;
  onBack?: () => void;
  onTakeover: () => Promise<void> | void;
  takeoverLoading?: boolean;
  onToggleSearch?: () => void;
  searchOpen?: boolean;
  /** Abre a tela de dados do contato. Sem ele, o bloco não vira botão. */
  onOpenContact?: () => void;
};

const PRESENCE: Record<ChatConversation["status"], string> = {
  bot: "Atendimento pela IA",
  human: "Atendimento humano",
  resolved: "Conversa resolvida",
};

export function ChatHeader({
  conversation,
  onBack,
  onTakeover,
  takeoverLoading,
  onToggleSearch,
  searchOpen = false,
  onOpenContact,
}: ChatHeaderProps) {
  const displayName = contactDisplayName(conversation);
  const isHuman = conversation.status === "human";

  return (
    // Em 320px sobravam ~88px para o nome depois dos botões: os espaçamentos
    // encolhem no celular e voltam ao normal a partir de `sm`.
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--wa-panel-border)] bg-[var(--wa-panel)] px-2 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            // `-ml-1.5` recupera espaço sem encolher o alvo de toque: o botão
            // continua com 44px, só encosta mais na borda.
            className="-ml-1.5 flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-meta)] hover:bg-black/5 dark:hover:bg-white/5 lg:hidden"
            aria-label="Voltar"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        )}

        {/* Foto e nome são UM alvo só, como no WhatsApp: dois botões vizinhos
            para a mesma tela dobrariam a parada do leitor de tela e criariam um
            vão morto de 8px entre eles.

            Os textos são `span`, não `p`: `<button>` aceita só conteúdo de
            frase, e um parágrafo dentro dele é HTML inválido. */}
        <IdentityWrapper displayName={displayName} onOpenContact={onOpenContact}>
          <ContactAvatar
            name={conversation.contact_name}
            phone={conversation.contact_phone}
            url={conversation.contact_avatar_url}
            className="size-10"
          />

          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium text-foreground">
              {displayName}
            </span>
            <span className="block truncate text-xs text-[var(--wa-meta)]">
              {PRESENCE[conversation.status]}
              {/* O telefone só a partir de `sm`: no celular ele espremia o nome
                  do contato, que é a informação que importa. Vinha cru do
                  WhatsApp ("558690000021") — `formatPhoneBR` é a mesma função da
                  tela de leads. */}
              {conversation.contact_phone ? (
                <span className="hidden sm:inline">
                  {` · ${formatPhoneBR(conversation.contact_phone)}`}
                </span>
              ) : null}
            </span>
          </span>
        </IdentityWrapper>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {onToggleSearch && (
          <button
            type="button"
            onClick={onToggleSearch}
            aria-label="Buscar nesta conversa"
            aria-pressed={searchOpen}
            // O atalho não tem onde se anunciar: sem o title ninguém descobre
            // que o Cmd+F foi tomado do navegador de propósito.
            title="Buscar nesta conversa (Ctrl/⌘ + F)"
            aria-keyshortcuts="Control+F Meta+F"
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9",
              searchOpen
                ? "bg-black/10 text-foreground dark:bg-white/15"
                : "text-[var(--wa-meta)] hover:bg-black/5 dark:hover:bg-white/10"
            )}
          >
            <SearchIcon className="size-[18px]" />
          </button>
        )}
        <button
          type="button"
          onClick={onTakeover}
          disabled={takeoverLoading}
          className={cn(
            "flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-white transition-colors disabled:opacity-60 sm:h-9",
            isHuman
              ? "bg-orange-500 hover:bg-orange-600"
              : "bg-[var(--wa-green-deep)] hover:opacity-90"
          )}
        >
          {takeoverLoading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : isHuman ? (
            <MessagesSquareIcon className="size-4" />
          ) : (
            <UserIcon className="size-4" />
          )}
          <span className="hidden sm:inline">
            {isHuman ? "Devolver à IA" : "Assumir"}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Bloco de identidade: vira botão quando há para onde ir, e continua sendo
 * texto quando não há. Sem o ramo inerte, um cabeçalho sem `onOpenContact`
 * teria um botão que não faz nada — pior que não ter botão.
 */
function IdentityWrapper({
  displayName,
  onOpenContact,
  children,
}: {
  displayName: string;
  onOpenContact?: () => void;
  children: React.ReactNode;
}) {
  if (!onOpenContact) {
    return <div className="flex min-w-0 items-center gap-2 sm:gap-3">{children}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpenContact}
      aria-label={`Dados de ${displayName}`}
      // `py-1` leva o alvo a 48px sem mexer na altura do cabeçalho, que é fixa
      // em 64px — o avatar sozinho daria 40px, abaixo do mínimo de toque.
      className="flex min-w-0 items-center gap-2 rounded-lg py-1 pe-2 text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3 dark:hover:bg-white/5"
    >
      {children}
    </button>
  );
}
