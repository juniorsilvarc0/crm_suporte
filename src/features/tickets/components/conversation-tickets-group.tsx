"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, ChevronRightIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { SlaBadge } from "@/features/tickets/components/sla-badge";
import { TicketPriorityBadge } from "@/features/tickets/components/ticket-priority-badge";
import {
  TicketStatusBadge,
  type TicketStatusBadgeValue,
} from "@/features/tickets/components/ticket-status-badge";
import type { ConversationTicketsState } from "@/features/tickets/hooks/use-conversation-tickets";
import { useNow } from "@/features/tickets/hooks/use-now";
import { useTicketQuickAction } from "@/features/tickets/hooks/use-ticket-quick-action";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { quickActions } from "@/features/tickets/lib/ticket-actions";
import { ticketFieldError, ticketRequest } from "@/features/tickets/lib/ticket-request";
import type {
  ActiveTicketData,
  TicketCatalog,
  TicketListItem,
  TicketStatusKey,
  TicketStatusOption,
} from "@/features/tickets/types";
import { cn } from "@/lib/utils";

// O grupo "Tickets" do painel do contato (UI.md §5.7.12) e a vista de trocar o
// foco. É CONTEÚDO do sheet do chat, não camada: herda a superfície
// `--wa-info-*`, e quem monta decide a casca (o título do grupo, a vista).

/** Quantas ações rápidas cabem no grupo; o resto fica no detalhe. */
const GROUP_QUICK_ACTIONS = 2;

const FOCUS_FAILURE_MESSAGE = "Não foi possível trocar o foco.";
const NETWORK_MESSAGE = "Não foi possível concluir a operação. Confira a conexão e tente de novo.";

/** Linha de ação do grupo: verde, com chevron (o molde do painel do contato). */
const GROUP_ACTION_CLASS =
  "flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-[15px] text-[var(--wa-green-deep)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const RETRY_CLASS =
  "min-h-11 shrink-0 rounded-lg px-3 text-[15px] font-medium text-[var(--wa-green-deep)] transition-colors hover:bg-[var(--wa-info-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type StatusCatalog = Pick<TicketCatalog, "statuses" | "transitions">;

function openCount(count: number): string {
  return `${count} ${count === 1 ? "aberto" : "abertos"}`;
}

function statusValue(
  key: TicketStatusKey,
  statuses: readonly TicketStatusOption[] | null
): TicketStatusBadgeValue {
  return statuses?.find((status) => status.key === key) ?? { key };
}

/**
 * As linhas do grupo "Tickets" (quem monta desenha o título e o cartão): o
 * ticket em foco com protocolo, título e selos, 1–2 ações rápidas, "Abrir
 * ticket", "Trocar foco (N abertos)" e "Novo ticket".
 *
 * A falha é do grupo: "Tentar de novo" relê só os tickets, e o resto do painel
 * segue de pé. Com dado anterior, ele continua na tela (velho) e o aviso vem
 * junto — "nenhum ticket" nunca aparece por causa de uma falha. Sem a matriz de
 * transições, as ações rápidas não somem caladas: o grupo diz e oferece reler.
 */
export function ConversationTicketsGroup({
  state,
  activeTicketId,
  catalog,
  catalogFailed,
  onRetryCatalog,
  viewerId,
  onChangeFocus,
  onNewTicket,
}: {
  state: ConversationTicketsState;
  /** `chat_conversations.active_ticket_id` (Realtime): o foco que a conversa diz ter. */
  activeTicketId: string | null;
  /** `null` = o catálogo ainda não veio ou falhou: sem ações rápidas, rótulos de recurso. */
  catalog: StatusCatalog | null;
  /** A leitura do catálogo falhou inteira. */
  catalogFailed: boolean;
  onRetryCatalog: () => void;
  /** Quem está logado; `null` = ainda não se sabe, e aí não há ações rápidas. */
  viewerId: string | null;
  onChangeFocus: () => void;
  onNewTicket: () => void;
}) {
  const { data, activeTicket, fetchedAt, loading, error, refresh } = state;
  const now = useNow(fetchedAt ?? "");
  const statuses = catalog?.statuses ?? null;
  const { run, pending } = useTicketQuickAction({ statuses, refresh });

  if (loading) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }

  const retryRow = error ? (
    <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
        {data ? "Não foi possível atualizar os tickets." : "Não foi possível carregar os tickets."}
      </span>
      <button type="button" onClick={refresh} className={RETRY_CLASS}>
        Tentar de novo
      </button>
    </div>
  ) : null;

  if (!data) return retryRow;

  const tickets = data.tickets;
  // O foco novo chegou pelo Realtime antes da releitura que o traz (a leitura
  // em tela ainda diz outro foco): espera, em vez de dizer "nenhum ticket em
  // foco" por um instante.
  const focusPending =
    activeTicketId !== null &&
    activeTicket === null &&
    data.active_ticket_id !== activeTicketId &&
    !error;
  const others = activeTicket ? tickets.length - 1 : tickets.length;
  const actions =
    activeTicket && catalog && viewerId
      ? quickActions(activeTicket, catalog.transitions, viewerId).slice(0, GROUP_QUICK_ACTIONS)
      : [];
  const actionsFailed = catalogFailed || (catalog !== null && catalog.transitions === null);

  return (
    <>
      {retryRow}

      {activeTicket ? (
        <>
          <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
            <span className="text-[13px] text-[var(--wa-info-label)] tabular-nums">
              {formatProtocol(activeTicket.number)} · em foco
            </span>
            <span className="text-[15px] break-words">{activeTicket.title}</span>
            {/* `div min-w-0`: o selo de largura variável cabe na coluna (UI.md §5.6.1). */}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <TicketStatusBadge status={statusValue(activeTicket.status, statuses)} />
              <TicketPriorityBadge priority={activeTicket.priority} />
              <SlaBadge ticket={activeTicket} now={now} />
            </div>
          </div>

          {actions.length > 0 ? (
            <div className="flex gap-2 px-4 py-2.5">
              {actions.map((action) => {
                const busy = pending?.actionId === action.id && pending.ticketId === activeTicket.id;
                return (
                  <button
                    key={action.id}
                    type="button"
                    disabled={pending !== null}
                    aria-busy={busy || undefined}
                    onClick={() => void run(activeTicket, action)}
                    className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--wa-info-active)] px-3 text-[15px] font-medium text-[var(--wa-green-deep)] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {busy ? <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin" /> : null}
                    <span className="truncate">{action.label}</span>
                  </button>
                );
              })}
            </div>
          ) : actionsFailed ? (
            <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
                Não foi possível carregar as ações do ticket.
              </span>
              <button type="button" onClick={onRetryCatalog} className={RETRY_CLASS}>
                Tentar de novo
              </button>
            </div>
          ) : null}

          {/* `next/link`, não `<a>`: sair do chat por documento inteiro pisca
              branco no PWA. */}
          <Link href={`/app/tickets/${activeTicket.number}`} className={GROUP_ACTION_CLASS}>
            <span className="truncate">Abrir ticket</span>
            <ChevronRightIcon aria-hidden className="size-[18px] shrink-0 text-[var(--wa-green-deep)]" />
          </Link>
        </>
      ) : focusPending ? (
        <SkeletonRow />
      ) : (
        <div className="flex min-h-11 items-center px-4 py-2.5">
          <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
            {tickets.length > 0 ? "Nenhum ticket em foco" : "Nenhum ticket aberto"}
          </span>
        </div>
      )}

      {others > 0 ? (
        <GroupActionButton
          label={
            activeTicket
              ? `Trocar foco (${openCount(tickets.length)})`
              : `Escolher o foco (${openCount(tickets.length)})`
          }
          onClick={onChangeFocus}
        />
      ) : null}
      <GroupActionButton label="Novo ticket" onClick={onNewTicket} />
    </>
  );
}

/**
 * A vista "tickets" do painel: os tickets não terminais da conversa, para pôr
 * outro em foco (PUT active-ticket). É o foco que carimba a mensagem nova.
 * Sucesso relê e volta (`onFocused`); falha fica aqui, com o toast.
 */
export function ConversationTicketsFocusList({
  conversationId,
  state,
  activeTicketId,
  statuses,
  onFocused,
}: {
  conversationId: string;
  state: ConversationTicketsState;
  activeTicketId: string | null;
  statuses: readonly TicketStatusOption[] | null;
  onFocused: () => void;
}) {
  const { data, fetchedAt, loading, error, refresh } = state;
  const now = useNow(fetchedAt ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Uma troca por vez: o `busyId` só desabilita a lista no próximo render.
  const inFlight = useRef(false);

  async function focus(ticket: TicketListItem) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(ticket.id);
    const result = await ticketRequest<ActiveTicketData>(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/active-ticket`,
      { method: "PUT", body: { ticket_id: ticket.id } }
    );
    inFlight.current = false;
    setBusyId(null);

    if (result.ok) {
      if (result.data.changed) {
        toast.success(`${formatProtocol(ticket.number)} agora está em foco na conversa.`);
      }
      refresh();
      onFocused();
      return;
    }
    toast.error(
      result.status === 0
        ? NETWORK_MESSAGE
        : (ticketFieldError(result.body) ?? result.body?.message ?? FOCUS_FAILURE_MESSAGE)
    );
    // A lista em tela está velha (ticket encerrado, de outra conversa, sumiu): relê.
    if (result.status === 404 || result.status === 409 || result.status === 422) refresh();
  }

  let content: ReactNode;
  if (loading) {
    content = (
      <>
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  } else if (!data) {
    content = (
      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
        <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
          Não foi possível carregar os tickets.
        </span>
        <button type="button" onClick={refresh} className={RETRY_CLASS}>
          Tentar de novo
        </button>
      </div>
    );
  } else if (data.tickets.length === 0) {
    content = (
      <div className="flex min-h-11 items-center px-4 py-2.5">
        <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
          Nenhum ticket aberto nesta conversa.
        </span>
      </div>
    );
  } else {
    content = data.tickets.map((ticket) => {
      const current = ticket.id === activeTicketId;
      const busy = busyId === ticket.id;
      const protocol = formatProtocol(ticket.number);
      return (
        <button
          key={ticket.id}
          type="button"
          disabled={current || busyId !== null}
          aria-current={current || undefined}
          onClick={() => void focus(ticket)}
          className={cn(
            "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
            !current && "hover:bg-[var(--wa-info-active)] disabled:opacity-60"
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] text-[var(--wa-info-label)] tabular-nums">
              {protocol}
              {current ? " · em foco" : null}
            </span>
            <span className="text-[15px] break-words text-foreground">{ticket.title}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <TicketStatusBadge status={statusValue(ticket.status, statuses)} />
              <SlaBadge ticket={ticket} now={now} />
            </span>
          </span>
          {busy ? (
            <Loader2Icon aria-hidden className="size-[18px] shrink-0 animate-spin text-[var(--wa-info-label)]" />
          ) : current ? (
            <CheckIcon aria-hidden className="size-[18px] shrink-0 text-[var(--wa-green-deep)]" />
          ) : null}
        </button>
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <p className="px-1 text-[13px] text-[var(--wa-info-label)]">
        A mensagem nova da conversa entra no ticket em foco.
      </p>
      {error && data ? (
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--wa-info-card)] px-4 py-2.5">
          <span className="min-w-0 truncate text-[15px] text-[var(--wa-info-label)]">
            Não foi possível atualizar os tickets.
          </span>
          <button type="button" onClick={refresh} className={RETRY_CLASS}>
            Tentar de novo
          </button>
        </div>
      ) : null}
      <div
        aria-busy={loading || undefined}
        className="divide-y divide-[var(--wa-info-divider)] overflow-hidden rounded-xl bg-[var(--wa-info-card)]"
      >
        {content}
      </div>
    </div>
  );
}

function GroupActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={GROUP_ACTION_CLASS}>
      <span className="truncate">{label}</span>
      <ChevronRightIcon aria-hidden className="size-[18px] shrink-0 text-[var(--wa-info-label)]" />
    </button>
  );
}

/**
 * Espaço da linha enquanto a rede responde, na altura da linha real (o molde
 * do painel do contato: `Skeleton` com o cinza da própria superfície).
 */
function SkeletonRow() {
  return (
    <div className="flex min-h-11 items-center px-4 py-2.5">
      <Skeleton className="h-4 w-2/5 bg-[var(--wa-info-active)]" />
    </div>
  );
}
