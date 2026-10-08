import Link from "next/link";
import { LayoutGridIcon, ListIcon } from "lucide-react";

import {
  ticketBoardHref,
  ticketListHref,
  type TicketListFilters,
} from "@/features/tickets/lib/ticket-list-url";
import { cn } from "@/lib/utils";

/**
 * Chave "Lista | Quadro" dos tickets. Dois `next/link` num controle segmentado:
 * a vista é a URL (a lista e o quadro são páginas), e os filtros que valem nas
 * duas (prioridade, fila, responsável, SLA) são preservados ao alternar — o
 * quadro não leva status, busca nem ordem (lá as colunas SÃO os status).
 *
 * Server-renderável (sem "use client"): são links, não estado.
 */
export function TicketViewSwitch({
  view,
  filters,
}: {
  view: "lista" | "quadro";
  filters: TicketListFilters;
}) {
  return (
    <div
      aria-label="Vista dos tickets"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5"
    >
      <SwitchTab href={ticketListHref(filters)} active={view === "lista"} label="Lista">
        <ListIcon className="size-4" aria-hidden />
      </SwitchTab>
      <SwitchTab href={ticketBoardHref(filters)} active={view === "quadro"} label="Quadro">
        <LayoutGridIcon className="size-4" aria-hidden />
      </SwitchTab>
    </div>
  );
}

function SwitchTab({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "bg-card text-foreground shadow-soft"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
      {label}
    </Link>
  );
}
