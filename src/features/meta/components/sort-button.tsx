"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

/**
 * Cabeçalho ordenável, compartilhado pelas duas tabelas da tela.
 *
 * Saiu de dentro de `campaign-report-table.tsx` quando a tabela de custos
 * apareceu: são dois blocos da **mesma tela**, e duplicar o controle deixaria
 * as duas ordenações divergirem em ícone, foco e alvo de toque na primeira vez
 * que uma delas fosse ajustada.
 */
export function SortButton({
  label,
  active,
  direction,
  onClick,
  align = "start",
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: "start" | "end";
}) {
  const Icon = !active ? ChevronsUpDownIcon : direction === "asc" ? ArrowUpIcon : ArrowDownIcon;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={`Ordenar por ${label}`}
      className={cn(
        "-mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        align === "end" && "flex-row-reverse",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      <Icon
        className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground/60")}
        aria-hidden
      />
    </button>
  );
}

/** `aria-sort` do `<th>`, que espera as palavras por extenso. */
export function ariaSort(active: boolean, direction: SortDirection) {
  if (!active) return "none" as const;
  return direction === "asc" ? ("ascending" as const) : ("descending" as const);
}
