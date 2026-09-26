"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  CrosshairIcon,
  Loader2Icon,
  RotateCwIcon,
  TicketIcon,
  TicketPlusIcon,
  UserRoundCheckIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { SlaBadge } from "@/features/tickets/components/sla-badge";
import type { ConversationTicketsState } from "@/features/tickets/hooks/use-conversation-tickets";
import { useNow } from "@/features/tickets/hooks/use-now";
import { useTicketQuickAction } from "@/features/tickets/hooks/use-ticket-quick-action";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { quickActions, ticketStatusLabel } from "@/features/tickets/lib/ticket-actions";
import type { TicketCatalog, TicketListItem, TicketStatusOption } from "@/features/tickets/types";
import { cn } from "@/lib/utils";

// O ticket em foco no cabeçalho do chat (spec 4e). É o cromo do chat, não o
// painel: herda a superfície `--wa-*` e só aparece a partir de `lg` (quem monta
// esconde); no celular o foco vive na linha de apoio e no painel do contato.

const PILL_HOVER = "transition-colors hover:bg-black/5 dark:hover:bg-white/10";
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Botão solto do cabeçalho em forma de pílula: "Abrir ticket" e "Recarregar ticket". */
const PILL_CLASS = cn(
  "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium [&_svg]:size-4",
  PILL_HOVER,
  FOCUS_RING
);

/** "SUP-1024 Em atendimento": o foco na linha de apoio do cabeçalho, com o rótulo do catálogo. */
export function focusTicketSummary(
  ticket: Pick<TicketListItem, "number" | "status">,
  statuses: readonly TicketStatusOption[] | null
): string {
  return `${formatProtocol(ticket.number)} ${ticketStatusLabel(ticket.status, statuses)}`;
}

function openCount(count: number): string {
  return `${count} ${count === 1 ? "aberto" : "abertos"}`;
}

/**
 * Chip do ticket em foco: o protocolo e o `SlaBadge` levam ao detalhe
 * (`next/link`: sair do chat por documento inteiro pisca branco no PWA), e o
 * menu ao lado tem as ações rápidas, "Abrir ticket" e "Trocar foco". Sem ticket
 * em foco, o chip vira "Abrir ticket" (o "Novo ticket" do painel do contato).
 *
 * O foco é o `activeTicketId` da conversa (Realtime); o resto do ticket vem da
 * leitura (`state`). Enquanto ela não traz o foco, o chip é esqueleto; a falha
 * vira "Recarregar ticket", nunca "Abrir ticket" — seria dizer que não há foco.
 */
export function ConversationTicketChip({
  activeTicketId,
  state,
  catalog,
  catalogFailed,
  onRetryCatalog,
  viewerId,
  onNewTicket,
  onChangeFocus,
}: {
  /** `chat_conversations.active_ticket_id`: o foco que a conversa diz ter. */
  activeTicketId: string | null;
  state: ConversationTicketsState;
  /** `null` = o catálogo ainda não veio ou falhou: sem ações rápidas, rótulos de recurso. */
  catalog: Pick<TicketCatalog, "statuses" | "transitions"> | null;
  catalogFailed: boolean;
  onRetryCatalog: () => void;
  /** Quem está logado; `null` = ainda não se sabe, e aí não há ações rápidas. */
  viewerId: string | null;
  /** Abre o painel do contato no "Novo ticket". */
  onNewTicket: () => void;
  /** Abre o painel do contato na lista para trocar o foco. */
  onChangeFocus: () => void;
}) {
  const { data, activeTicket, fetchedAt, loading, error, refresh } = state;
  const now = useNow(fetchedAt ?? "");
  const statuses = catalog?.statuses ?? null;
  const { run, pending } = useTicketQuickAction({ statuses, refresh });

  if (activeTicketId === null) {
    return <NewTicketChip onClick={onNewTicket} />;
  }

  if (!activeTicket) {
    if (error) {
      return (
        <button
          type="button"
          onClick={refresh}
          title="Não foi possível carregar o ticket em foco."
          className={cn(PILL_CLASS, "text-[var(--wa-meta)]")}
        >
          <RotateCwIcon aria-hidden />
          Recarregar ticket
        </button>
      );
    }
    // O foco e a leitura discordam (um dos dois chegou antes: o Realtime da
    // conversa ou a releitura): espera a outra metade, em vez de pintar um
    // chip que vai mudar no instante seguinte.
    const focusPending = data !== null && data.active_ticket_id !== activeTicketId;
    if (loading || focusPending) {
      return <Skeleton aria-hidden className="h-9 w-40 shrink-0 rounded-full bg-black/5 dark:bg-white/10" />;
    }
    // A leitura confirma o foco e não o traz entre os não terminais (o banco
    // não deixa isso acontecer): para a tela, não há ticket em foco.
    return <NewTicketChip onClick={onNewTicket} />;
  }

  const protocol = formatProtocol(activeTicket.number);
  const href = `/app/tickets/${activeTicket.number}`;
  const actions = catalog && viewerId ? quickActions(activeTicket, catalog.transitions, viewerId) : [];
  const actionsFailed = catalogFailed || (catalog !== null && catalog.transitions === null);
  const openTickets = data?.tickets.length ?? 0;
  const busy = pending !== null;

  return (
    // `data-ticket-chip`: é por ele que a coluna do cabeçalho só encolhe com o
    // chip de foco (o único que trunca).
    <div data-ticket-chip="focus" className="flex h-9 min-w-0 items-center rounded-full bg-black/5 dark:bg-white/5">
      <Link
        href={href}
        title={`${protocol} · ${activeTicket.title}`}
        className={cn("flex h-full min-w-0 items-center gap-2 rounded-s-full ps-3 pe-2 text-[13px]", PILL_HOVER, FOCUS_RING)}
      >
        <span className="shrink-0 font-medium tabular-nums text-foreground">{protocol}</span>
        {/* Embrulho `min-w-0`: o `shrink-0` do selo venceria a linha, e o chip
            não encolheria (UI.md §5.6.1). */}
        <span className="block min-w-0">
          <SlaBadge ticket={activeTicket} now={now} />
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={busy}
              aria-busy={busy || undefined}
              aria-label={`Ações de ${protocol}`}
              className={cn(
                "flex h-full w-9 shrink-0 items-center justify-center rounded-e-full border-s border-black/10 text-[var(--wa-meta)] disabled:opacity-60 dark:border-white/10",
                PILL_HOVER,
                FOCUS_RING
              )}
            />
          }
        >
          {busy ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-1.5">
          {actions.map((action) => (
            <DropdownMenuItem key={action.id} onClick={() => void run(activeTicket, action)}>
              {action.kind === "take_over" ? <UserRoundCheckIcon /> : <ArrowRightIcon />}
              {action.label}
            </DropdownMenuItem>
          ))}
          {/* Sem a matriz, as ações somem: a falha não pode parecer "sem ações". */}
          {actionsFailed ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Não foi possível carregar as ações.</DropdownMenuLabel>
              <DropdownMenuItem onClick={onRetryCatalog}>
                <RotateCwIcon />
                Tentar de novo
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
          {actions.length > 0 || actionsFailed ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem render={<Link href={href} />}>
            <TicketIcon />
            Abrir ticket
          </DropdownMenuItem>
          {openTickets > 1 ? (
            <DropdownMenuItem onClick={onChangeFocus}>
              <CrosshairIcon />
              {`Trocar foco (${openCount(openTickets)})`}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Sem ticket em foco: abre o "Novo ticket" do painel do contato. */
function NewTicketChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(PILL_CLASS, "text-[var(--wa-green-deep)]")}
    >
      <TicketPlusIcon aria-hidden />
      Abrir ticket
    </button>
  );
}
