import { badgeVariants } from "@/components/ui/badge";
import { getColorStyle, isColorName } from "@/features/tags/schemas/colors";
import {
  TICKET_STATUS_FALLBACK_COLOR,
  TICKET_STATUS_FALLBACK_LABEL,
} from "@/features/tickets/lib/ticket-status";
import type { TicketStatusKey } from "@/features/tickets/types";
import { cn } from "@/lib/utils";

// O status como o selo o lê: a chave do ticket e, quando o catálogo carregou, o
// rótulo e a cor do admin (um TicketStatusOption serve direto).
export type TicketStatusBadgeValue = {
  key: TicketStatusKey;
  label?: string | null;
  color?: string | null;
};

/**
 * Selo do status do ticket, no molde do `ContractStatusBadge`.
 *
 * Rótulo e cor vêm do catálogo (4f); sem eles, ou com cor fora da paleta
 * (`isColorName`), valem os de recurso de `lib/ticket-status.ts` para a MESMA
 * chave. O texto está SEMPRE presente — a cor só reforça (UI.md §1.4). `<span>`
 * puro com as classes do `Badge`: renderiza igual em server e client component.
 *
 * Largura variável (UI.md §5.6.1): `max-w-full` no selo, `min-w-0` no texto e o
 * rótulo inteiro no `title`. Em linha flex, quem chama embrulha num `div min-w-0`.
 */
export function TicketStatusBadge({
  status,
  className,
}: {
  status: TicketStatusBadgeValue;
  className?: string;
}) {
  const label = status.label?.trim() || TICKET_STATUS_FALLBACK_LABEL[status.key];
  const color =
    status.color && isColorName(status.color)
      ? status.color
      : TICKET_STATUS_FALLBACK_COLOR[status.key];

  return (
    <span
      data-slot="badge"
      title={label}
      className={cn(
        badgeVariants({ variant: "outline" }),
        getColorStyle(color).badge,
        "max-w-full",
        className
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
