"use client";

import { ArchiveIcon, ChevronRightIcon, TagIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * As duas portas do topo da lista, no formato do WhatsApp Business: arquivadas
 * e etiquetas, cada uma com contador e chevron.
 *
 * Substituem o chip "Arquivadas" da barra de filtros. Chip e linha para o mesmo
 * lugar seriam duas portas na mesma tela; a linha ganha porque carrega o
 * contador — que é a informação que faz alguém decidir entrar.
 *
 * O acento é o verde do chat, não o azul da referência: o app já tem um acento
 * de interação, e um segundo faria a lista disputar leitura consigo mesma.
 */
export function ConversationListShortcuts({
  archivedCount,
  activeTagsLabel,
  onOpenArchived,
  onOpenLabels,
}: {
  archivedCount: number;
  /**
   * O que está filtrando a lista agora, como valor da linha: o nome da etiqueta
   * quando é uma só, a contagem quando são várias (uma fileira de nomes
   * truncados não informaria nada).
   */
  activeTagsLabel: string | null;
  onOpenArchived: () => void;
  onOpenLabels: () => void;
}) {
  return (
    <div className="shrink-0 divide-y divide-[var(--wa-panel-border)] border-b border-[var(--wa-panel-border)]">
      <ShortcutRow
        icon={<ArchiveIcon />}
        label="Conversas arquivadas"
        // Zero não vira "0": um contador zerado só ocupa espaço afirmando que
        // não há nada, e a própria linha já leva a uma tela que diz isso melhor.
        value={archivedCount > 0 ? String(archivedCount) : null}
        onClick={onOpenArchived}
      />
      <ShortcutRow
        icon={<TagIcon />}
        label="Etiquetas"
        value={activeTagsLabel}
        highlightValue={Boolean(activeTagsLabel)}
        onClick={onOpenLabels}
      />
    </div>
  );
}

function ShortcutRow({
  icon,
  label,
  value,
  highlightValue = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  highlightValue?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 px-3 text-left transition-colors",
        "hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/5"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          "bg-[var(--wa-green)]/12 text-[var(--wa-green-deep)]",
          "[&_svg]:size-[18px] [&_svg]:stroke-[1.8]"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{label}</span>
      {value ? (
        <span
          className={cn(
            "shrink-0 truncate text-[13px] tabular-nums",
            highlightValue ? "text-[var(--wa-green-deep)]" : "text-[var(--wa-meta)]"
          )}
        >
          {value}
        </span>
      ) : null}
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-[var(--wa-meta)]" />
    </button>
  );
}
