"use client";

import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { getPersonSignal } from "@/features/home/lib/person-status";
import type { HomePerson } from "@/features/home/types";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

/**
 * Cartão de pessoa da tela de Início: quem é, o que vem a seguir e a conversa
 * a um toque. O botão do WhatsApp abre o **chat interno** — nunca wa.me.
 */
export function PersonCard({
  person,
  now,
  onOpenChat,
  pending,
}: {
  person: HomePerson;
  /** Instante de referência, vindo do servidor: evita hidratação divergente. */
  now: Date;
  onOpenChat: (person: HomePerson) => void;
  pending: boolean;
}) {
  const signal = getPersonSignal(person, now);
  const name = person.name?.trim() || "Sem nome";

  return (
    <article className="group/person flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-soft transition-transform duration-150 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <AvatarInitials name={person.name} size="lg" className="bg-primary/10 text-primary" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-semibold">{name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", signal.dot)} />
          <span className="truncate">{signal.label}</span>
        </p>
        {person.phone ? (
          <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-muted-foreground/80">
            {formatPhone(person.phone)}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onOpenChat(person)}
        disabled={!person.phone || pending}
        aria-label={`Abrir conversa com ${name}`}
        title="Abrir conversa"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[#128C7E] outline-none transition-colors hover:bg-[#25D366]/20 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-10 dark:text-[#25D366]"
      >
        <WhatsAppIcon className={cn("size-[18px]", pending && "animate-pulse")} />
      </button>
    </article>
  );
}
