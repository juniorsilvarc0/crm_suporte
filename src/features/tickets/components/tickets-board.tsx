"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CopyIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { ActiveFilters, FilterButton } from "@/components/data-display/data-toolbar";
import { EmptyState } from "@/components/data-display/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/kibo-ui/kanban";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import { CancelTicketDialog } from "@/features/tickets/components/cancel-ticket-dialog";
import { SLA_TONE_STYLE, SlaBadge } from "@/features/tickets/components/sla-badge";
import {
  TicketFilterFields,
  type TicketFilterQueue,
  type TicketFilterUser,
} from "@/features/tickets/components/ticket-filters";
import { TicketPriorityBadge } from "@/features/tickets/components/ticket-priority-badge";
import { TicketViewSwitch } from "@/features/tickets/components/ticket-view-switch";
import { useNow } from "@/features/tickets/hooks/use-now";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { getSlaState } from "@/features/tickets/lib/sla";
import { allowedTargets, canTransition } from "@/features/tickets/lib/state-machine";
import { ticketActionErrorMessage } from "@/features/tickets/lib/ticket-action-error";
import { ticketStatusLabel } from "@/features/tickets/lib/ticket-actions";
import {
  countTicketBoardFilters,
  QUADRO_PATH,
  ticketBoardHref,
  toListFilters,
  type TicketListFilters,
} from "@/features/tickets/lib/ticket-list-url";
import { postTicketAction, type TicketRequestFailure } from "@/features/tickets/lib/ticket-request";
import type {
  TicketListItem,
  TicketListParams,
  TicketsBoard,
  TicketStatusKey,
  TicketStatusOption,
  TicketTransition,
} from "@/features/tickets/types";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

export type TicketsBoardCatalog = {
  statuses: TicketStatusOption[] | null;
  transitions: TicketTransition[] | null;
  queues: TicketFilterQueue[] | null;
};

type BoardColumn = { id: TicketStatusKey; name: string };
type BoardItem = { id: string; name: string; column: string; ticket: TicketListItem };

function toBoardItem(ticket: TicketListItem): BoardItem {
  return { id: ticket.id, name: ticket.title, column: ticket.status, ticket };
}

function conversationHref(ticket: Pick<TicketListItem, "conversation_id">): string {
  return `/app/chat?conversation=${encodeURIComponent(ticket.conversation_id)}`;
}

function ticketContext(ticket: TicketListItem): string {
  const contact = ticket.contact.name?.trim() || formatPhone(ticket.contact.phone);
  return ticket.customer ? `${customerDisplayName(ticket.customer)} · ${contact}` : contact;
}

/**
 * Quadro (kanban) dos tickets (/app/tickets/quadro). Colunas = os status
 * NÃO-TERMINAIS (a pilha de trabalho); mover um card entre colunas é uma
 * transição de status. Terminais (resolvido, fechado, cancelado) saem do quadro
 * ao mover — não há coluna para eles; vão pelo menu "Mover para" do card.
 *
 * O arraste é otimista: o provider move o card na hora; a transição vai ao
 * servidor e, se falhar (409 de versão/transição inválida), o card volta. Uma
 * ação por vez (como a lista): a segunda sairia com a versão velha da primeira.
 * Sem Realtime: relê (router.refresh) após cada ação e ao voltar para a aba.
 */
export function TicketsBoard({
  board,
  params,
  catalog,
  users,
  viewerId,
}: {
  board: TicketsBoard;
  params: TicketListParams;
  catalog: TicketsBoardCatalog;
  users: readonly TicketFilterUser[] | null;
  viewerId: string;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const now = useNow(board.fetchedAt);

  // Estado local dos cards, ressincronizado a cada leitura do servidor (o
  // fetchedAt muda). Entre leituras, o arraste muda a coluna aqui.
  const [items, setItems] = useState<BoardItem[]>(() => (board.items ?? []).map(toBoardItem));
  const [syncedAt, setSyncedAt] = useState(board.fetchedAt);
  if (board.fetchedAt !== syncedAt) {
    setSyncedAt(board.fetchedAt);
    setItems((board.items ?? []).map(toBoardItem));
  }

  // Uma ação por vez: o `busy` (ref) é a trava; o `busyId` só pinta o véu.
  const busy = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Coluna de origem de cada arraste em curso (o provider já moveu o card).
  const dragFrom = useRef(new Map<string, string>());

  const [cancelTarget, setCancelTarget] = useState<TicketListItem | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Sem Realtime de tickets: voltar para a aba relê, em segundo plano.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  const filters = toListFilters(params);
  function changeFilters(patch: Partial<TicketListFilters>) {
    startNavigation(() => router.replace(ticketBoardHref({ ...filters, ...patch }), { scroll: false }));
  }
  function clearFilters() {
    startNavigation(() => router.replace(QUADRO_PATH, { scroll: false }));
  }

  function refresh() {
    startNavigation(() => router.refresh());
  }

  function reportFailure(ticket: TicketListItem, result: TicketRequestFailure) {
    toast.error(ticketActionErrorMessage(result, ticket.status, catalog.statuses));
    if (result.status === 409 || result.status === 404) refresh();
  }

  // O provider chama meu onDragEnd ANTES do reorder final, e `data` ainda é o do
  // render: uma reversão síncrona seria sobrescrita. Por isso a reversão é
  // adiada para depois da atualização do provider (microtask).
  function scheduleRevert(id: string, column: string) {
    queueMicrotask(() =>
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, column } : item)))
    );
  }

  async function runTransition(ticket: TicketListItem, to: TicketStatusKey, revertColumn?: string) {
    busy.current = true;
    setBusyId(ticket.id);
    const result = await postTicketAction(ticket.id, "transition", { to, version: ticket.version });
    busy.current = false;
    setBusyId(null);
    if (result.ok) {
      toast.success(
        `${formatProtocol(ticket.number)} movido para ${ticketStatusLabel(to, catalog.statuses)}.`
      );
      refresh();
      return;
    }
    if (revertColumn) scheduleRevert(ticket.id, revertColumn);
    reportFailure(ticket, result);
  }

  // Menu "Mover para": cancelar pede motivo (diálogo); o resto vai direto.
  function moveTo(ticket: TicketListItem, to: TicketStatusKey) {
    if (busy.current) return;
    if (to === "cancelado") {
      setCancelTarget(ticket);
      setCancelOpen(true);
      return;
    }
    void runTransition(ticket, to);
  }

  function onCancelled(ticket: Pick<TicketListItem, "number">) {
    toast.success(
      `${formatProtocol(ticket.number)} movido para ${ticketStatusLabel("cancelado", catalog.statuses)}.`
    );
    refresh();
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const current = items.find((item) => item.id === id)?.column;
    if (current) dragFrom.current.set(id, current);
  }

  function onDragEnd(event: DragEndEvent) {
    const id = String(event.active.id);
    const from = dragFrom.current.get(id);
    dragFrom.current.delete(id);
    // Depois do dragOver, a coluna do item já é o destino.
    const to = items.find((item) => item.id === id)?.column;
    if (!from || !to || from === to) return;

    // Uma ação por vez, ou transição que a matriz não permite: desfaz o arraste.
    if (busy.current || !canTransition(catalog.transitions, from as TicketStatusKey, to as TicketStatusKey)) {
      scheduleRevert(id, from);
      if (!busy.current) {
        toast.error(`Não dá para mover para ${ticketStatusLabel(to as TicketStatusKey, catalog.statuses)}.`);
      }
      return;
    }

    const ticket = items.find((item) => item.id === id)?.ticket;
    if (ticket) void runTransition(ticket, to as TicketStatusKey, from);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <TicketViewSwitch view="quadro" filters={filters} />
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <FilterButton activeCount={countTicketBoardFilters(filters)}>
          <TicketFilterFields
            hideStatus
            filters={filters}
            onChange={changeFilters}
            statuses={catalog.statuses}
            queues={catalog.queues}
            users={users}
            viewerId={viewerId}
            items={board.items ?? []}
            protocolSearch={false}
          />
        </FilterButton>
        <ActiveFilters count={countTicketBoardFilters(filters)} onClear={clearFilters} />
      </div>
    </div>
  );

  if (board.items === null || catalog.statuses === null) {
    return (
      <div className="space-y-3">
        <BoardHeader />
        {toolbar}
        <EmptyState>
          <span className="flex flex-col items-center gap-3">
            <span>Não foi possível carregar o quadro.</span>
            <Button type="button" variant="outline" onClick={refresh} className="h-11 sm:h-9">
              <RotateCwIcon data-icon="inline-start" className={cn(navigating && "animate-spin")} />
              Tentar de novo
            </Button>
          </span>
        </EmptyState>
      </div>
    );
  }

  // Colunas = status não-terminais, na ordem do catálogo (por position).
  const columns: BoardColumn[] = catalog.statuses
    .filter((status) => !status.is_terminal)
    .map((status) => ({ id: status.key, name: status.label }));

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      <BoardHeader />
      {toolbar}
      {board.capped ? (
        <p className="text-xs text-muted-foreground">
          Mostrando os primeiros {items.length} tickets ativos. Use os filtros para focar.
        </p>
      ) : null}

      <div
        aria-busy={navigating || undefined}
        className={cn("min-h-0 flex-1", navigating && "opacity-60")}
      >
        <KanbanProvider<BoardItem, BoardColumn>
          columns={columns}
          data={items}
          onDataChange={setItems}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="h-[calc(100vh-15rem)] min-h-96"
        >
          {(column) => {
            const count = items.filter((item) => item.column === column.id).length;
            return (
              <KanbanBoard id={column.id} key={column.id}>
                <KanbanHeader className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
                  <span className="truncate text-foreground">{column.name}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </KanbanHeader>
                <KanbanCards<BoardItem>
                  id={column.id}
                  empty={
                    <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                      Nada aqui.
                    </p>
                  }
                >
                  {(item) => (
                    <KanbanCard {...item} key={item.id}>
                      <BoardCard
                        ticket={item.ticket}
                        now={now}
                        busy={busyId === item.id}
                        disabled={busyId !== null || navigating}
                        targets={allowedTargets(catalog.transitions, item.ticket.status)}
                        statuses={catalog.statuses}
                        onMove={(to) => moveTo(item.ticket, to)}
                      />
                    </KanbanCard>
                  )}
                </KanbanCards>
              </KanbanBoard>
            );
          }}
        </KanbanProvider>
      </div>

      <CancelTicketDialog
        ticket={cancelTarget}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onCancelled={onCancelled}
        onFailure={reportFailure}
      />
    </div>
  );
}

function BoardHeader() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Tickets</h1>
      <p className="min-h-5 text-sm text-muted-foreground">Quadro por status — arraste para mover.</p>
    </div>
  );
}

/** O conteúdo de um card do quadro. O card inteiro é arrastável (kibo-ui). */
function BoardCard({
  ticket,
  now,
  busy,
  disabled,
  targets,
  statuses,
  onMove,
}: {
  ticket: TicketListItem;
  now: Date;
  busy: boolean;
  disabled: boolean;
  targets: TicketStatusKey[];
  statuses: TicketStatusOption[] | null;
  onMove: (to: TicketStatusKey) => void;
}) {
  const tone = getSlaState(ticket, now).tone;
  return (
    <div className={cn("relative min-w-0 space-y-1.5", busy && "opacity-60")}>
      {/* Barra de acento na cor do SLA; o selo com o texto está logo abaixo,
          então a cor nunca é o único sinal (UI.md §1.4). */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 -left-3.5 w-1.5 rounded-l-xl", SLA_TONE_STYLE[tone].bar)}
      />
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
          {formatProtocol(ticket.number)}
        </span>
        {/* data-no-pan: não inicia o pan horizontal do board ao clicar no menu. */}
        <div data-no-pan className="relative z-10 -mr-1 -mt-1 shrink-0">
          <BoardCardMenu
            ticket={ticket}
            busy={busy}
            disabled={disabled}
            targets={targets}
            statuses={statuses}
            onMove={onMove}
          />
        </div>
      </div>
      <SlaBadge ticket={ticket} now={now} />
      <Link
        href={`/app/tickets/${ticket.number}`}
        data-no-pan
        className="block rounded-sm text-sm font-semibold break-words outline-none underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        title={ticket.title}
      >
        {ticket.title}
      </Link>
      <p className="truncate text-xs text-muted-foreground" title={ticketContext(ticket)}>
        {ticketContext(ticket)}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <TicketPriorityBadge priority={ticket.priority} />
        {ticket.product ? (
          <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {ticket.product.name}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
        {ticket.assignee ? (
          <>
            <AvatarInitials name={ticket.assignee.name} size="sm" />
            <span className="min-w-0 truncate" title={ticket.assignee.name}>
              {ticket.assignee.name}
            </span>
          </>
        ) : (
          <span>Sem responsável</span>
        )}
      </div>
    </div>
  );
}

function BoardCardMenu({
  ticket,
  busy,
  disabled,
  targets,
  statuses,
  onMove,
}: {
  ticket: TicketListItem;
  busy: boolean;
  disabled: boolean;
  targets: TicketStatusKey[];
  statuses: TicketStatusOption[] | null;
  onMove: (to: TicketStatusKey) => void;
}) {
  const protocol = formatProtocol(ticket.number);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-busy={busy || undefined}
            className="size-8 text-muted-foreground"
            aria-label={`Ações de ${protocol}`}
          />
        }
      >
        {busy ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 p-1.5">
        <DropdownMenuItem
          className="min-h-11 sm:min-h-8"
          render={<Link href={conversationHref(ticket)} />}
        >
          <span aria-hidden className="inline-flex shrink-0">
            <WhatsAppIcon className="size-4" />
          </span>
          Abrir conversa
        </DropdownMenuItem>
        {targets.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              {targets.map((to) => (
                <DropdownMenuItem
                  key={to}
                  variant={to === "cancelado" ? "destructive" : "default"}
                  className="min-h-11 sm:min-h-8"
                  onClick={() => onMove(to)}
                >
                  {to === "cancelado" ? <XIcon /> : <ArrowRightIcon />}
                  {ticketStatusLabel(to, statuses)}
                  {to === "cancelado" ? "…" : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11 sm:min-h-8"
          onClick={() => {
            void navigator.clipboard
              .writeText(protocol)
              .then(() => toast.success("Protocolo copiado."))
              .catch(() => toast.error("Não foi possível copiar o protocolo."));
          }}
        >
          <CopyIcon />
          Copiar protocolo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
