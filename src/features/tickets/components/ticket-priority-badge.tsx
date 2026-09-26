import { badgeVariants } from "@/components/ui/badge";
import { getColorStyle, type ColorName } from "@/features/tags/schemas/colors";
import { TICKET_PRIORITY_LABEL } from "@/features/tickets/lib/ticket-priority";
import type { TicketPriority } from "@/features/tickets/types";
import { cn } from "@/lib/utils";

// A prioridade não tem cor no banco (sla_policies só guarda minutos e aviso):
// mapa fixo, como o CONTRACT_STATUS_COLOR. Baixa e média ficam discretas; a cor
// quente é reservada a alta e crítica, que são as que pedem atenção.
const PRIORITY_COLOR: Record<TicketPriority, ColorName> = {
  baixa: "gray",
  media: "slate",
  alta: "orange",
  critica: "red",
};

/**
 * Selo da prioridade do ticket ("Baixa", "Média", "Alta", "Crítica"), no molde
 * do `ContractStatusBadge`: `<span>` com as classes do `Badge`, texto sempre
 * presente (a cor só reforça) e `max-w-full` + `min-w-0` para caber em coluna
 * estreita (UI.md §5.6.1).
 */
export function TicketPriorityBadge({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  const label = TICKET_PRIORITY_LABEL[priority];

  return (
    <span
      data-slot="badge"
      title={label}
      className={cn(
        badgeVariants({ variant: "outline" }),
        getColorStyle(PRIORITY_COLOR[priority]).badge,
        "max-w-full",
        className
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
