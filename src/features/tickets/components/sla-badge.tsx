import { badgeVariants } from "@/components/ui/badge";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { getSlaState, type SlaTone } from "@/features/tickets/lib/sla";
import type { TicketSlaFields } from "@/features/tickets/types";
import { cn } from "@/lib/utils";

const AMBER = getColorStyle("amber");
const EMERALD = getColorStyle("emerald");

/**
 * Cor de cada tom do SLA: `badge` para o selo, `bar` para a barra de acento do
 * cartão da lista no celular (4a). Tokens semânticos onde existem (UI.md §3.1):
 * `destructive` para o estouro, `muted` para a pausa e o cancelado, `primary` na
 * barra do que corre no prazo. Aviso e "no prazo" não têm token semântico: usam
 * a paleta de domínio, como o `ContractStatusBadge` (suspenso = amber, ativo =
 * emerald). O resolvido fora do prazo é destrutivo sem fundo: é histórico, não
 * pede ação como o estouro que ainda corre.
 */
export const SLA_TONE_STYLE: Record<SlaTone, { badge: string; bar: string }> = {
  ok: { badge: "border-border text-foreground", bar: "bg-primary" },
  warn: { badge: AMBER.badge, bar: AMBER.bar },
  breached: {
    badge: "border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20",
    bar: "bg-destructive",
  },
  paused: { badge: "border-border bg-muted text-muted-foreground", bar: "bg-muted-foreground/40" },
  met: { badge: EMERALD.badge, bar: EMERALD.bar },
  missed: { badge: "border-destructive/30 text-destructive", bar: "bg-destructive/50" },
  none: { badge: "border-border text-muted-foreground", bar: "bg-border" },
};

/**
 * Selo do SLA do ticket ("Vence em 2 horas", "Pausado · restavam 3 horas"), no
 * molde do `ContractStatusBadge`. Texto e tom saem de `getSlaState`, a mesma
 * regra da view ticket_queue; `now` é de quem chama (na tela, o `useNow` que
 * começa no fetchedAt do servidor, para a hidratação sair igual).
 *
 * Instante inválido dá rótulo vazio, e aí não há selo: a tela não inventa prazo.
 * `max-w-full` + `min-w-0` para caber em coluna estreita (UI.md §5.6.1).
 */
export function SlaBadge({
  ticket,
  now,
  className,
}: {
  ticket: TicketSlaFields;
  now: Date;
  className?: string;
}) {
  const { tone, label } = getSlaState(ticket, now);
  if (!label) return null;

  return (
    <span
      data-slot="badge"
      data-tone={tone}
      title={label}
      className={cn(
        badgeVariants({ variant: "outline" }),
        SLA_TONE_STYLE[tone].badge,
        "max-w-full",
        className
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
