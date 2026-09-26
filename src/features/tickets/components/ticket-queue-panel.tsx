"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, Loader2Icon, MessageSquareReplyIcon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { badgeVariants } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import { SlaBadge } from "@/features/tickets/components/sla-badge";
import { TicketPriorityBadge } from "@/features/tickets/components/ticket-priority-badge";
import { useNow } from "@/features/tickets/hooks/use-now";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { invalidTransitionMessage } from "@/features/tickets/lib/ticket-actions";
import { DEFAULT_TICKET_LIST_FILTERS, ticketListHref } from "@/features/tickets/lib/ticket-list-url";
import {
  ticketFieldError,
  ticketRequest,
  type TicketRequestFailure,
} from "@/features/tickets/lib/ticket-request";
import type {
  TakeOverTicketData,
  TicketListItem,
  TicketQueue,
  TicketQueueSection,
  TransitionTicketData,
} from "@/features/tickets/types";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

const CONFLICT_MESSAGE = "O ticket mudou em outro lugar.";
const FAILURE_MESSAGE = "Não foi possível concluir a operação.";
const NETWORK_MESSAGE = "Não foi possível concluir a operação. Confira a conexão e tente de novo.";

// Sem a leitura (viewer que não passou do banco): as duas seções em falha, com
// "Tentar de novo". Nunca "nenhum ticket", que seria inventar uma fila vazia.
const UNAVAILABLE: TicketQueueSection = { items: [], total: 0, failed: true };

type QueueAction = "take_over" | "reopen" | "close";

type QueueSectionKey = "mine" | "unassigned";

// "Ver todos (N)" abre a lista com o recorte da seção: o grupo "pendentes" (o
// mesmo filtro de getTicketQueue) e o responsável. Mesmo recorte, mesmo total.
const SECTION_COPY: Record<
  QueueSectionKey,
  { title: string; href: string; empty: string; failure: string }
> = {
  mine: {
    title: "Minha fila",
    href: ticketListHref({ ...DEFAULT_TICKET_LIST_FILTERS, status: "pendentes", responsavel: "eu" }),
    empty: "Nenhum ticket com você agora.",
    failure: "Não foi possível carregar a sua fila.",
  },
  unassigned: {
    title: "Não atribuídos",
    href: ticketListHref({ ...DEFAULT_TICKET_LIST_FILTERS, status: "pendentes", responsavel: "nenhum" }),
    empty: "Nenhum ticket esperando responsável.",
    failure: "Não foi possível carregar os tickets não atribuídos.",
  },
};

/** "Padaria São João · Maria Souza"; sem empresa, só o contato (nome ou telefone). */
function ticketContext(ticket: TicketListItem): string {
  const contact = ticket.contact.name?.trim() || formatPhone(ticket.contact.phone);
  return ticket.customer ? `${customerDisplayName(ticket.customer)} · ${contact}` : contact;
}

function ticketActionUrl(ticketId: string, action: "take-over" | "transition"): string {
  return `/api/tickets/${encodeURIComponent(ticketId)}/${action}`;
}

/**
 * Texto do toast de uma ação recusada. Sem o catálogo no Início, a transição
 * fora da matriz usa os rótulos de recurso dos status.
 */
function actionErrorMessage(result: TicketRequestFailure, ticket: TicketListItem): string {
  if (result.status === 0) return NETWORK_MESSAGE;
  const payload = result.body;
  switch (payload?.code) {
    case "version_conflict":
      return CONFLICT_MESSAGE;
    case "already_assigned": {
      const protocol = formatProtocol(ticket.number);
      return payload.assigned_to_name
        ? `${payload.assigned_to_name} já pegou ${protocol}.`
        : `Alguém já pegou ${protocol}.`;
    }
    case "invalid_transition":
      return invalidTransitionMessage(
        { message: payload.message ?? FAILURE_MESSAGE, allowed: payload.allowed, current: payload.current },
        ticket.status,
        null
      );
  }
  return ticketFieldError(payload) ?? payload?.message ?? FAILURE_MESSAGE;
}

/**
 * A fila do Início (spec 4d), em duas seções lado a lado a partir de `lg`, no
 * recorte e na ordem que getTicketQueue devolve (a tela não reordena):
 *
 * - **Minha fila:** os meus com relógio correndo ou pausado, mais o resolvido
 *   em que o cliente respondeu depois;
 * - **Não atribuídos:** o mesmo recorte sem responsável, com **Atender**
 *   (take-over: conversa em humano, ticket em foco e meu).
 *
 * Nas duas, o resolvido respondido vem primeiro, com o selo "Respondeu após
 * resolver" e Reabrir · Fechar na linha (no lugar de Atender: assumir não
 * reabre). Resolvido não reabre sozinho (decisão 4 da Fase 4): o sinal é o que
 * chama o analista, e vem da view (`replied_after_resolve`), não da tela.
 *
 * Até 8 por seção, com "Ver todos (N)" para a lista filtrada. Cada seção tem o
 * próprio vazio e a própria falha: a falha de uma não apaga a outra.
 *
 * Sem Realtime de tickets: relê a página (`router.refresh()`) depois de cada
 * ação e ao voltar para a aba. Uma ação por vez: a trava é uma ref, porque o
 * `pending` só desabilita os botões no próximo render, e durante a releitura a
 * linha ainda tem a versão de antes da ação.
 */
export function TicketQueuePanel({ queue }: { queue: TicketQueue | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  // O relógio do selo começa no instante da leitura: HTML e hidratação iguais.
  const now = useNow(queue?.fetchedAt ?? "");
  const [pending, setPending] = useState<{ ticketId: string; action: QueueAction } | null>(null);
  const inFlight = useRef(false);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  // Sem Realtime de tickets: voltar para a aba relê a fila, em segundo plano.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") startRefresh(() => router.refresh());
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  async function runAction(ticket: TicketListItem, action: QueueAction) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending({ ticketId: ticket.id, action });

    const protocol = formatProtocol(ticket.number);
    try {
      if (action === "take_over") {
        // O corpo é JSON mesmo sem campo: `{}` (a rota confere com zod).
        const result = await ticketRequest<TakeOverTicketData>(
          ticketActionUrl(ticket.id, "take-over"),
          { method: "POST", body: {} }
        );
        if (result.ok) {
          toast.success(`Você assumiu ${protocol}.`);
          refresh();
          return;
        }
        reportFailure(ticket, result);
        return;
      }

      const to = action === "reopen" ? "em_atendimento" : "fechado";
      const result = await ticketRequest<TransitionTicketData>(
        ticketActionUrl(ticket.id, "transition"),
        { method: "POST", body: { to, version: ticket.version } }
      );
      if (result.ok) {
        if (result.data.changed) {
          toast.success(action === "reopen" ? `${protocol} reaberto.` : `${protocol} fechado.`);
        }
        refresh();
        return;
      }
      reportFailure(ticket, result);
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function reportFailure(ticket: TicketListItem, result: TicketRequestFailure) {
    toast.error(actionErrorMessage(result, ticket));
    // 409 = o ticket mudou (versão, status, alguém pegou); 404 = saiu da base.
    // A linha em tela está velha: relê.
    if (result.status === 409 || result.status === 404) refresh();
  }

  const sectionProps = {
    now,
    pending,
    refreshing,
    disabled: pending !== null || refreshing,
    onAction: (ticket: TicketListItem, action: QueueAction) => void runAction(ticket, action),
    onRetry: refresh,
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
      <QueueSection sectionKey="mine" section={queue?.mine ?? UNAVAILABLE} {...sectionProps} />
      <QueueSection
        sectionKey="unassigned"
        section={queue?.unassigned ?? UNAVAILABLE}
        {...sectionProps}
      />
    </div>
  );
}

type QueueSectionProps = {
  sectionKey: QueueSectionKey;
  section: TicketQueueSection;
  now: Date;
  pending: { ticketId: string; action: QueueAction } | null;
  refreshing: boolean;
  disabled: boolean;
  onAction: (ticket: TicketListItem, action: QueueAction) => void;
  onRetry: () => void;
};

function QueueSection({
  sectionKey,
  section,
  now,
  pending,
  refreshing,
  disabled,
  onAction,
  onRetry,
}: QueueSectionProps) {
  const titleId = useId();
  const copy = SECTION_COPY[sectionKey];
  const { items, total, failed } = section;

  let content: ReactNode;
  if (failed) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>{copy.failure}</span>
          <Button
            type="button"
            variant="outline"
            onClick={onRetry}
            disabled={refreshing}
            className="h-11 sm:h-9"
          >
            <RotateCwIcon data-icon="inline-start" className={cn(refreshing && "animate-spin")} />
            Tentar de novo
          </Button>
        </span>
      </EmptyState>
    );
  } else if (items.length === 0) {
    content = <EmptyState>{copy.empty}</EmptyState>;
  } else {
    content = (
      <ul className="divide-y divide-border/60">
        {items.map((ticket) => {
          const replied = ticket.replied_after_resolve;
          const actions: { action: QueueAction; label: string }[] = replied
            ? [
                { action: "reopen", label: "Reabrir" },
                { action: "close", label: "Fechar" },
              ]
            : sectionKey === "unassigned"
              ? [{ action: "take_over", label: "Atender" }]
              : [];
          return (
            <QueueRow
              key={ticket.id}
              ticket={ticket}
              now={now}
              replied={replied}
              actions={actions}
              pendingAction={pending?.ticketId === ticket.id ? pending.action : null}
              disabled={disabled}
              onAction={(action) => onAction(ticket, action)}
            />
          );
        })}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={refreshing || undefined}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="font-display text-base font-semibold">
          {copy.title}
        </h2>
        {!failed && total > 0 ? (
          <Link
            href={copy.href}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "-me-2 h-11 text-primary tabular-nums sm:h-8"
            )}
          >
            Ver todos ({total})
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        ) : null}
      </div>
      {content}
    </section>
  );
}

/**
 * Uma linha da fila: protocolo (o link do detalhe, esticado por cima da linha),
 * selos de SLA e prioridade, título e empresa · contato. As ações ficam acima
 * do link esticado e continuam clicáveis.
 */
function QueueRow({
  ticket,
  now,
  replied,
  actions,
  pendingAction,
  disabled,
  onAction,
}: {
  ticket: TicketListItem;
  now: Date;
  replied: boolean;
  actions: { action: QueueAction; label: string }[];
  pendingAction: QueueAction | null;
  disabled: boolean;
  onAction: (action: QueueAction) => void;
}) {
  const protocol = formatProtocol(ticket.number);
  const context = ticketContext(ticket);

  return (
    <li
      className={cn(
        "group relative flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3",
        pendingAction && "opacity-60"
      )}
    >
      {/* ⚠️ `grid-cols-[minmax(0,1fr)]` NÃO é enfeite: sem trilha declarada, o
          título longo alarga a linha em vez de truncar (UI.md §9). */}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Link
            href={`/app/tickets/${ticket.number}`}
            className="shrink-0 rounded-sm font-mono text-xs font-medium tabular-nums text-muted-foreground outline-none transition-colors after:absolute after:inset-0 after:rounded-lg hover:text-foreground focus-visible:after:ring-3 focus-visible:after:ring-inset focus-visible:after:ring-ring/50"
          >
            {protocol}
          </Link>
          <div className="min-w-0">
            <SlaBadge ticket={ticket} now={now} />
          </div>
          <TicketPriorityBadge priority={ticket.priority} />
          {replied ? (
            <span
              data-slot="badge"
              className={cn(
                badgeVariants({ variant: "outline" }),
                "max-w-full border-primary/30 bg-primary/10 text-primary"
              )}
            >
              <MessageSquareReplyIcon aria-hidden />
              <span className="min-w-0 truncate">Respondeu após resolver</span>
            </span>
          ) : null}
        </div>
        <p
          className="line-clamp-2 break-words font-medium transition-colors group-hover:text-primary"
          title={ticket.title}
        >
          {ticket.title}
        </p>
        <p className="truncate text-[13px] text-muted-foreground" title={context}>
          {context}
        </p>
      </div>

      {actions.length > 0 ? (
        // Acima do link esticado: o botão continua clicável.
        <div className="relative z-10 flex shrink-0 gap-2">
          {actions.map(({ action, label }) => (
            <Button
              key={action}
              type="button"
              variant="outline"
              disabled={disabled}
              aria-busy={pendingAction === action || undefined}
              aria-label={`${label} ${protocol}`}
              onClick={() => onAction(action)}
              className="h-11 flex-1 sm:h-8 sm:flex-none"
            >
              {pendingAction === action ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : null}
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
