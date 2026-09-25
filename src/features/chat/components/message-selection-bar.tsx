"use client";

import { ForwardIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Barra do modo de seleção. **Substitui o compositor**, como no WhatsApp: em
 * modo de seleção não se escreve, se escolhe.
 */
export function MessageSelectionBar({
  count,
  onCancel,
  onForward,
}: {
  count: number;
  onCancel: () => void;
  onForward: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-t border-[var(--wa-panel-border)] bg-[var(--wa-panel)] px-3 sm:px-5">
      <button
        type="button"
        onClick={onCancel}
        aria-label="Sair da seleção"
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--wa-meta)] transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10 sm:size-9"
      >
        <XIcon className="size-5" />
      </button>

      <p className="min-w-0 flex-1 truncate text-[15px]" aria-live="polite">
        {count === 0
          ? "Nenhuma selecionada"
          : `${count} selecionada${count > 1 ? "s" : ""}`}
      </p>

      <button
        type="button"
        onClick={onForward}
        disabled={count === 0}
        aria-label="Encaminhar selecionadas"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors sm:size-10",
          "text-[var(--wa-meta)] hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:opacity-40 disabled:hover:bg-transparent"
        )}
      >
        <ForwardIcon className="size-5" />
      </button>
    </div>
  );
}
