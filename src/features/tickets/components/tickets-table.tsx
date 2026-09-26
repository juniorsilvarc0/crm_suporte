"use client";

import {
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import {
  ArrowRightIcon,
  CopyIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RotateCwIcon,
  UserRoundCheckIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AvatarInitials } from "@/components/data-display/avatar-initials";
import {
  ActiveFilters,
  DataToolbar,
  FilterButton,
  ToolbarSearch,
} from "@/components/data-display/data-toolbar";
import { EmptyState } from "@/components/data-display/empty-state";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import { SLA_TONE_STYLE, SlaBadge } from "@/features/tickets/components/sla-badge";
import {
  TicketFilterFields,
  TicketOrderSelect,
  type TicketFilterQueue,
  type TicketFilterUser,
} from "@/features/tickets/components/ticket-filters";
import { TicketPriorityBadge } from "@/features/tickets/components/ticket-priority-badge";
import {
  TicketStatusBadge,
  type TicketStatusBadgeValue,
} from "@/features/tickets/components/ticket-status-badge";
import { useNow } from "@/features/tickets/hooks/use-now";
import { getSlaState } from "@/features/tickets/lib/sla";
import { invalidTransitionMessage, ticketStatusLabel } from "@/features/tickets/lib/ticket-actions";
import {
  countTicketFilters,
  DEFAULT_TICKET_LIST_FILTERS,
  ticketListHref,
  type TicketListFilters,
} from "@/features/tickets/lib/ticket-list-url";
import { formatProtocol, parseProtocolQuery } from "@/features/tickets/lib/protocol";
import { allowedTargets } from "@/features/tickets/lib/state-machine";
import { ticketTransitionSchema } from "@/features/tickets/schemas/ticket";
import type {
  TicketErrorBody,
  TicketListItem,
  TicketListParams,
  TicketStatusKey,
  TicketStatusOption,
  TicketsPage,
  TicketTransition,
} from "@/features/tickets/types";
import { formatDateTime, toAppDate } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import { humanizeSince } from "@/lib/formatters/relative-time";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 300;
// Mesmo teto de parseTicketListParams: o termo que a URL devolve é o que foi
// digitado, e o campo não "pula" quando a busca chega.
const SEARCH_MAX_LENGTH = 100;

const CONFLICT_MESSAGE = "O ticket mudou em outro lugar.";
const TAKEN_MESSAGE = "Alguém já pegou este ticket.";
const FAILURE_MESSAGE = "Não foi possível concluir a operação.";
const NETWORK_MESSAGE = "Não foi possível concluir a operação. Confira a conexão e tente de novo.";

/** O que a lista usa do catálogo (getTicketCatalog). Parte `null` = não carregou. */
export type TicketsTableCatalog = {
  statuses: TicketStatusOption[] | null;
  transitions: TicketTransition[] | null;
  queues: TicketFilterQueue[] | null;
};

// Corpo de POST /api/tickets/[id]/assign e /transition, como a tela o lê: no
// sucesso só `ok` importa (a lista relê do servidor); no erro, o TicketErrorBody.
type TicketActionPayload = { ok?: boolean } & Partial<Omit<TicketErrorBody, "ok">>;

// `status` 0 = a requisição nem chegou (rede).
type TicketActionResult =
  | { ok: true }
  | { ok: false; status: number; payload: TicketActionPayload | null };

type TicketAction = "assign" | "transition";

async function postTicketAction(
  ticketId: string,
  action: TicketAction,
  body: Record<string, unknown>
): Promise<TicketActionResult> {
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as TicketActionPayload | null;
    if (response.ok && payload?.ok) return { ok: true };
    return { ok: false, status: response.status, payload };
  } catch {
    return { ok: false, status: 0, payload: null };
  }
}

/**
 * Texto do toast de uma ação recusada. Conflito de versão e ticket já pego têm
 * frase própria (a lista relê em seguida); transição fora da matriz lista os
 * destinos com os rótulos do catálogo. O resto usa o que a rota disse.
 */
function actionErrorMessage(
  result: Extract<TicketActionResult, { ok: false }>,
  fromStatus: TicketStatusKey,
  statuses: TicketStatusOption[] | null
): string {
  if (result.status === 0) return NETWORK_MESSAGE;
  const payload = result.payload;
  switch (payload?.code) {
    case "version_conflict":
      return CONFLICT_MESSAGE;
    case "already_assigned":
      return TAKEN_MESSAGE;
    case "invalid_transition":
      return invalidTransitionMessage(
        { message: payload.message ?? FAILURE_MESSAGE, allowed: payload.allowed, current: payload.current },
        fromStatus,
        statuses
      );
  }
  const fieldMessage = Object.values(payload?.errors ?? {}).find((messages) => messages?.[0])?.[0];
  return fieldMessage ?? payload?.message ?? FAILURE_MESSAGE;
}

function ticketHref(ticket: Pick<TicketListItem, "number">): string {
  return `/app/tickets/${ticket.number}`;
}

function conversationHref(ticket: Pick<TicketListItem, "conversation_id">): string {
  return `/app/chat?conversation=${encodeURIComponent(ticket.conversation_id)}`;
}

/** "Padaria São João · Maria Souza"; sem empresa, só o contato (nome ou telefone). */
function ticketContext(ticket: TicketListItem): string {
  const contact = ticket.contact.name?.trim() || formatPhone(ticket.contact.phone);
  return ticket.customer ? `${customerDisplayName(ticket.customer)} · ${contact}` : contact;
}

/**
 * "há 3 horas" da última alteração. O `now` é o do relógio da tela: o instante
 * gravado um pouco depois dele (leitura em curso, relógio do banco adiantado)
 * fica "agora", nunca "em menos de 1 min".
 */
function updatedAgo(ticket: TicketListItem, now: Date): string {
  const updated = toAppDate(ticket.updated_at);
  if (!updated) return "";
  return humanizeSince(updated.getTime() > now.getTime() ? now : updated, now);
}

function filtersOf(params: TicketListParams): TicketListFilters {
  return {
    q: params.q,
    status: params.status,
    prioridade: params.prioridade,
    fila: params.fila,
    responsavel: params.responsavel,
    sla: params.sla,
    ordem: params.ordem,
  };
}

/**
 * Lista de tickets (/app/tickets). A URL é a fonte da verdade (`q`, `status`,
 * `prioridade`, `fila`, `responsavel`, `sla`, `ordem`, `page`): o servidor
 * filtra e pagina, e esta tela só escreve a URL — molde de Clientes.
 *
 * Sem Realtime de tickets: a lista relê do servidor (`router.refresh()`) ao
 * voltar para a aba e depois de cada ação. Sem ação em massa: cada ticket muda
 * com a própria versão. O selo de SLA roda no relógio `useNow`, que começa no
 * instante da leitura (`fetchedAt`) para o HTML do servidor e a hidratação
 * saírem iguais.
 */
export function TicketsTable({
  page,
  params,
  catalog,
  users,
  viewerId,
}: {
  page: TicketsPage;
  params: TicketListParams;
  catalog: TicketsTableCatalog;
  /** `null` = a leitura da equipe falhou. */
  users: readonly TicketFilterUser[] | null;
  viewerId: string;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const now = useNow(page.fetchedAt);
  const urlFilters = useMemo(() => filtersOf(params), [params]);
  // Os selects mostram a escolha na hora; a URL confirma quando a lista chega.
  const [filters, setOptimisticFilters] = useOptimistic(urlFilters);

  const [searchQuery, setSearchQuery] = useState(params.q);
  // Último termo que ESTA tela pediu à URL.
  const [requestedQuery, setRequestedQuery] = useState(params.q);
  // A URL mudou. Se foi esta tela que pediu, o campo já mostra isso (ou algo
  // mais novo que a pessoa continuou digitando) e não é tocado. Se veio de
  // fora — "Tickets" no menu, voltar do navegador —, o campo segue a URL; sem
  // isso, a busca antiga voltaria para a URL 300ms depois. Ajuste durante o
  // render, mesmo padrão de Clientes.
  const [urlQuery, setUrlQuery] = useState(params.q);
  if (params.q !== urlQuery) {
    setUrlQuery(params.q);
    if (params.q !== requestedQuery) {
      setSearchQuery(params.q);
      setRequestedQuery(params.q);
    }
  }

  function navigate(next: TicketListFilters) {
    setRequestedQuery(next.q);
    startNavigation(() => {
      setOptimisticFilters(next);
      router.replace(ticketListHref(next), { scroll: false });
    });
  }

  function changeFilters(patch: Partial<TicketListFilters>) {
    navigate({ ...filters, q: searchQuery.trim(), ...patch });
  }

  // O termo vai para a URL (é o servidor que pagina), mas só depois da pausa de
  // digitação — sem isso cada tecla viraria uma navegação.
  useEffect(() => {
    const query = searchQuery.trim();
    if (query === requestedQuery) return;

    const timeout = window.setTimeout(() => {
      setRequestedQuery(query);
      startNavigation(() => {
        // `filters`, não a URL: um filtro escolhido agora e ainda a caminho não
        // é desfeito pela busca que chega depois dele.
        router.replace(ticketListHref({ ...filters, q: query }), { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [filters, requestedQuery, router, searchQuery]);

  // Sem Realtime de tickets: voltar para a aba relê a lista, em segundo plano.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  function clearFilters() {
    setSearchQuery("");
    // A ordem não é filtro: fica.
    navigate({ ...DEFAULT_TICKET_LIST_FILTERS, ordem: filters.ordem });
  }

  function refresh() {
    startNavigation(() => router.refresh());
  }

  // Uma ação por vez: cada uma leva a versão que a tela leu, e a segunda
  // sairia com a versão velha da primeira. O `busyId` só desabilita os menus no
  // próximo render; a trava é o ref.
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = useRef(false);

  function reportFailure(ticket: TicketListItem, result: Extract<TicketActionResult, { ok: false }>) {
    toast.error(actionErrorMessage(result, ticket.status, catalog.statuses));
    // 409 = o ticket mudou (versão, status, responsável); 404 = saiu da base.
    // A linha em tela está velha: relê.
    if (result.status === 409 || result.status === 404) refresh();
  }

  async function runAction(
    ticket: TicketListItem,
    action: TicketAction,
    body: Record<string, unknown>,
    success: string
  ) {
    if (busy.current) return;
    busy.current = true;
    setBusyId(ticket.id);
    const result = await postTicketAction(ticket.id, action, body);
    busy.current = false;
    setBusyId(null);
    if (result.ok) {
      toast.success(success);
      refresh();
      return;
    }
    reportFailure(ticket, result);
  }

  function assignToMe(ticket: TicketListItem) {
    void runAction(
      ticket,
      "assign",
      { assignee_id: viewerId, version: ticket.version },
      `${formatProtocol(ticket.number)} agora é seu.`
    );
  }

  // Dois estados, `cancelOpen` e o ticket: fechar não zera o ticket, senão o
  // conteúdo do diálogo sumiria no meio da animação de saída.
  const [cancelTarget, setCancelTarget] = useState<TicketListItem | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  function moveTo(ticket: TicketListItem, to: TicketStatusKey) {
    // Cancelar exige motivo: abre o diálogo em vez de mover.
    if (to === "cancelado") {
      setCancelTarget(ticket);
      setCancelOpen(true);
      return;
    }
    void runAction(
      ticket,
      "transition",
      { to, version: ticket.version },
      `${formatProtocol(ticket.number)} movido para ${ticketStatusLabel(to, catalog.statuses)}.`
    );
  }

  function onCancelled(ticket: TicketListItem) {
    toast.success(
      `${formatProtocol(ticket.number)} movido para ${ticketStatusLabel("cancelado", catalog.statuses)}.`
    );
    refresh();
  }

  async function copyProtocol(ticket: TicketListItem) {
    try {
      await navigator.clipboard.writeText(formatProtocol(ticket.number));
      toast.success("Protocolo copiado.");
    } catch {
      toast.error("Não foi possível copiar o protocolo.");
    }
  }

  // Linha inteira clicável no desktop. O título é o link de verdade (teclado,
  // leitor de tela, abrir em nova aba); o resto da linha é atalho de mouse.
  function openFromRow(event: MouseEvent<HTMLTableRowElement>, href: string) {
    const target = event.target;
    // O menu ⋯ é portado para fora da linha, mas o clique nele sobe pela árvore
    // do React até aqui: só conta o que está DENTRO da linha no DOM.
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target.closest("a, button")) return;
    // Arrastar para copiar o título também termina num clique: não navega.
    if (window.getSelection()?.toString()) return;
    router.push(href);
  }

  function statusValue(key: TicketStatusKey): TicketStatusBadgeValue {
    return catalog.statuses?.find((status) => status.key === key) ?? { key };
  }

  const rowMenu = (ticket: TicketListItem) => (
    <TicketRowMenu
      ticket={ticket}
      viewerId={viewerId}
      targets={allowedTargets(catalog.transitions, ticket.status)}
      statuses={catalog.statuses}
      busy={busyId === ticket.id}
      // Durante a releitura a linha ainda tem a versão de antes da ação: uma
      // segunda ação agora sairia com ela e voltaria "mudou em outro lugar".
      disabled={busyId !== null || navigating}
      onAssignToMe={() => assignToMe(ticket)}
      onMove={(to) => moveTo(ticket, to)}
      onCopy={() => void copyProtocol(ticket)}
    />
  );

  const filterCount = countTicketFilters(filters);
  const activeCount = filterCount + Number(searchQuery.trim() !== "");
  const protocolSearch = parseProtocolQuery(searchQuery) !== null;
  // O que a lista em tela reflete é a URL, não o que ainda está sendo digitado.
  const urlFilterCount = countTicketFilters(urlFilters);
  const defaultView = params.q === "" && urlFilterCount === 0;
  // Sem busca e sem filtro, a não ser "todos" no status: vazio aqui é "não há
  // tickets (ativos)", não "a busca não achou".
  const unfiltered =
    defaultView || (params.q === "" && params.status === "todos" && urlFilterCount === 1);
  const { items, total } = page;

  const countLabel = page.failed
    ? ""
    : defaultView
      ? `${total} ${total === 1 ? "ticket ativo" : "tickets ativos"}`
      : `${total} ${total === 1 ? "ticket encontrado" : "tickets encontrados"}`;

  let content: ReactNode;
  if (page.failed) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>Não foi possível carregar os tickets.</span>
          <Button
            type="button"
            variant="outline"
            onClick={refresh}
            disabled={navigating}
            className="h-11 sm:h-9"
          >
            <RotateCwIcon data-icon="inline-start" className={cn(navigating && "animate-spin")} />
            Tentar de novo
          </Button>
        </span>
      </EmptyState>
    );
  } else if (items.length === 0 && unfiltered) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span className="flex flex-col gap-1">
            <span className="font-medium text-foreground">
              {params.status === "ativos" ? "Nenhum ticket ativo." : "Nenhum ticket ainda."}
            </span>
            <span>Tickets nascem de uma conversa no WhatsApp.</span>
          </span>
          <span className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/app/chat" className={cn(buttonVariants({ variant: "outline" }), "h-11 sm:h-9")}>
              {/* O ícone traz `aria-label` próprio: aqui é decoração do texto. */}
              <span aria-hidden className="inline-flex shrink-0">
                <WhatsAppIcon className="size-4" />
              </span>
              Abrir o WhatsApp
            </Link>
            {params.status === "ativos" ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => changeFilters({ status: "todos" })}
                className="h-11 sm:h-9"
              >
                Ver todos os tickets
              </Button>
            ) : null}
          </span>
        </span>
      </EmptyState>
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>Nenhum ticket encontrado.</span>
          <Button type="button" variant="outline" onClick={clearFilters} className="h-11 sm:h-9">
            <XIcon data-icon="inline-start" />
            Limpar filtros
          </Button>
        </span>
      </EmptyState>
    );
  } else {
    content = (
      // Linha = cartão (UI.md §3.3): o leito tingido é o que faz o cartão
      // branco existir. Oito colunas não cabem num tablet: a tabela é de `lg`
      // para cima, e abaixo disso a pilha de cartões.
      <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20 shadow-soft">
        <div className="hidden px-2 pb-2 lg:block">
          <Table variant="cards" className="table-fixed">
            <TableHeader>
              <TableRow variant="cards-header">
                <TableHead className="w-24 pl-3 sm:pl-4">Protocolo</TableHead>
                <TableHead>Título</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24">Prioridade</TableHead>
                <TableHead className="w-40">SLA</TableHead>
                <TableHead className="w-32">Responsável</TableHead>
                <TableHead className="hidden w-32 text-right xl:table-cell">Atualizado</TableHead>
                <TableHead className="w-14">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((ticket) => {
                const href = ticketHref(ticket);
                return (
                  <TableRow
                    key={ticket.id}
                    variant="card"
                    onClick={(event) => openFromRow(event, href)}
                    className={cn("cursor-pointer", busyId === ticket.id && "opacity-60")}
                  >
                    <TableCell className="py-3 pl-3 font-mono text-xs font-medium tabular-nums text-muted-foreground sm:pl-4">
                      {formatProtocol(ticket.number)}
                    </TableCell>
                    <TableCell className="max-w-0 py-3">
                      <TicketIdentity ticket={ticket} href={href} />
                    </TableCell>
                    <TableCell className="max-w-0 py-3">
                      <TicketStatusBadge status={statusValue(ticket.status)} />
                    </TableCell>
                    <TableCell className="max-w-0 py-3">
                      <TicketPriorityBadge priority={ticket.priority} />
                    </TableCell>
                    <TableCell className="max-w-0 py-3">
                      <SlaBadge ticket={ticket} now={now} />
                    </TableCell>
                    <TableCell className="max-w-0 py-3">
                      <AssigneeName assignee={ticket.assignee} />
                    </TableCell>
                    <TableCell
                      className="hidden py-3 text-right text-sm tabular-nums text-muted-foreground xl:table-cell"
                      title={formatDateTime(ticket.updated_at)}
                    >
                      {updatedAgo(ticket, now)}
                    </TableCell>
                    <TableCell className="py-3 pr-2 text-right">{rowMenu(ticket)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Abaixo de `lg`, uma pilha de cartões; o título é o link esticado. */}
        <div className="grid gap-2 p-2 lg:hidden">
          {items.map((ticket) => {
            const tone = getSlaState(ticket, now).tone;
            return (
              <article
                key={ticket.id}
                // ⚠️ `grid-cols-[minmax(0,1fr)]` NÃO é enfeite: grid sem coluna
                // declarada cria trilha implícita com piso no min-content, e o
                // cartão fica mais largo que o celular (ver Clientes).
                className={cn(
                  "relative grid w-full grid-cols-[minmax(0,1fr)] gap-1.5 overflow-hidden rounded-xl border border-border/70 bg-card py-3 pl-5 pr-3 transition-colors hover:bg-muted/40",
                  busyId === ticket.id && "opacity-60"
                )}
              >
                {/* Barra de acento na cor do SLA; o selo com o texto está na 1ª
                    linha, então a cor nunca é o único sinal (UI.md §1.4). */}
                <span
                  aria-hidden
                  className={cn("absolute inset-y-0 left-0 w-1.5", SLA_TONE_STYLE[tone].bar)}
                />
                {/* ⚠️ `min-w-0` nas linhas do cartão: são itens de grid, e o
                    Safari do iPhone deixava o texto estourar sem ele. */}
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-muted-foreground">
                      {formatProtocol(ticket.number)}
                    </span>
                    <div className="min-w-0">
                      <SlaBadge ticket={ticket} now={now} />
                    </div>
                  </div>
                  {/* Acima do link esticado: o ⋯ continua clicável. */}
                  <div className="relative z-10 -my-1.5 shrink-0">{rowMenu(ticket)}</div>
                </div>
                <TicketIdentity ticket={ticket} href={ticketHref(ticket)} stretched />
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <div className="min-w-0">
                    <TicketStatusBadge status={statusValue(ticket.status)} />
                  </div>
                  <TicketPriorityBadge priority={ticket.priority} />
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {ticket.assignee ? ticket.assignee.name : "Sem responsável"}
                  </span>
                  <span className="shrink-0 tabular-nums" title={formatDateTime(ticket.updated_at)}>
                    Atualizado {updatedAgo(ticket, now)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="tickets-title" className="space-y-3">
      <div>
        <h1 id="tickets-title" className="font-display text-2xl font-semibold tracking-tight">
          Tickets
        </h1>
        {/* `aria-live`: o número é a única confirmação de que a busca pegou
            para quem não vê a lista. */}
        <p aria-live="polite" className="min-h-5 text-sm tabular-nums text-muted-foreground">
          {countLabel}
        </p>
      </div>

      {/* A barra nunca some: nem na base vazia, nem na lista que falhou. */}
      <DataToolbar>
        <ToolbarSearch
          type="search"
          enterKeyHint="search"
          aria-label="Buscar ticket por título, protocolo, empresa ou contato"
          placeholder="Título, SUP-1024, empresa ou contato…"
          autoComplete="off"
          spellCheck={false}
          maxLength={SEARCH_MAX_LENGTH}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <FilterButton activeCount={filterCount}>
            <TicketFilterFields
              filters={filters}
              onChange={changeFilters}
              statuses={catalog.statuses}
              queues={catalog.queues}
              users={users}
              viewerId={viewerId}
              items={items}
              protocolSearch={protocolSearch}
            />
          </FilterButton>
          <TicketOrderSelect value={filters.ordem} onChange={(ordem) => changeFilters({ ordem })} />
          <ActiveFilters count={activeCount} onClear={clearFilters} />
        </div>
      </DataToolbar>

      <div
        aria-busy={navigating || undefined}
        className={cn(
          "transition-opacity motion-reduce:transition-none",
          navigating && "opacity-60"
        )}
      >
        {content}
      </div>

      <CancelTicketDialog
        ticket={cancelTarget}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onCancelled={onCancelled}
        onFailure={reportFailure}
      />
    </section>
  );
}

/**
 * Título (o link do detalhe) e, embaixo, empresa · contato em 13 px. `stretched`
 * estica o link por cima do cartão inteiro e deixa o título em até 2 linhas.
 */
function TicketIdentity({
  ticket,
  href,
  stretched = false,
}: {
  ticket: TicketListItem;
  href: string;
  stretched?: boolean;
}) {
  const context = ticketContext(ticket);
  return (
    <div className="min-w-0">
      <Link
        href={href}
        title={ticket.title}
        className={cn(
          "rounded-sm font-semibold outline-none underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
          stretched
            ? "line-clamp-2 break-words after:absolute after:inset-0 after:rounded-xl hover:no-underline focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-inset focus-visible:after:ring-ring/50"
            : "block truncate"
        )}
      >
        {ticket.title}
      </Link>
      <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={context}>
        {context}
      </p>
    </div>
  );
}

function AssigneeName({ assignee }: { assignee: TicketListItem["assignee"] }) {
  if (!assignee) return <span className="text-sm text-muted-foreground">Sem responsável</span>;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AvatarInitials name={assignee.name} size="sm" />
      <span className="min-w-0 truncate text-sm" title={assignee.name}>
        {assignee.name}
      </span>
    </div>
  );
}

/**
 * Menu ⋯ da linha: Abrir conversa, Atribuir a mim, Mover para… (só os destinos
 * da matriz do banco; sem o catálogo, nenhum) e Copiar protocolo.
 */
function TicketRowMenu({
  ticket,
  viewerId,
  targets,
  statuses,
  busy,
  disabled,
  onAssignToMe,
  onMove,
  onCopy,
}: {
  ticket: TicketListItem;
  viewerId: string;
  targets: TicketStatusKey[];
  statuses: TicketStatusOption[] | null;
  busy: boolean;
  disabled: boolean;
  onAssignToMe: () => void;
  onMove: (to: TicketStatusKey) => void;
  onCopy: () => void;
}) {
  const protocol = formatProtocol(ticket.number);
  // Encerrado não muda de responsável (TICKET_TERMINAL); o que já é meu, também não.
  const canAssign = !ticket.is_terminal && ticket.assignee?.id !== viewerId;

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
            className="size-11 text-muted-foreground sm:size-8"
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
        {canAssign ? (
          <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onAssignToMe}>
            <UserRoundCheckIcon />
            Atribuir a mim
          </DropdownMenuItem>
        ) : null}
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
                  {/* Reticências: Cancelado abre o diálogo do motivo. */}
                  {ticketStatusLabel(to, statuses)}
                  {to === "cancelado" ? "…" : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onCopy}>
          <CopyIcon />
          Copiar protocolo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type CancelFormValues = z.input<typeof ticketTransitionSchema>;
type CancelFormOutput = z.output<typeof ticketTransitionSchema>;

type CancelTicketDialogProps = {
  ticket: TicketListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled: (ticket: TicketListItem) => void;
  onFailure: (ticket: TicketListItem, result: Extract<TicketActionResult, { ok: false }>) => void;
};

/**
 * "Mover para Cancelado" pede o motivo (a rota exige; a RPC confere de novo).
 * Cada abertura é um formulário novo, com a versão que a lista leu.
 */
function CancelTicketDialog({ ticket, open, ...props }: CancelTicketDialogProps) {
  // Mesmo ajuste durante o render do formulário de empresa: o estado do
  // react-hook-form sobreviveria entre aberturas, com o motivo da anterior.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((current) => current + 1);
  }

  if (!ticket) return null;
  return <CancelTicketForm key={`${ticket.id}:${session}`} ticket={ticket} open={open} {...props} />;
}

function CancelTicketForm({
  ticket,
  open,
  onOpenChange,
  onCancelled,
  onFailure,
}: Omit<CancelTicketDialogProps, "ticket"> & { ticket: TicketListItem }) {
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);
  const protocol = formatProtocol(ticket.number);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CancelFormValues, unknown, CancelFormOutput>({
    resolver: zodResolver(ticketTransitionSchema),
    defaultValues: { to: "cancelado", version: ticket.version, reason: "" },
  });

  function handleOpenChange(next: boolean) {
    // Não fecha no meio do envio: a resposta ainda vai pintar erro aqui.
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function onValid(values: CancelFormOutput) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    const result = await postTicketAction(ticket.id, "transition", values);
    submitting.current = false;
    setPending(false);

    if (result.ok) {
      onOpenChange(false);
      onCancelled(ticket);
      return;
    }
    const reasonError = result.payload?.errors?.reason?.[0];
    if (reasonError) {
      setError("reason", { type: "server", message: reasonError }, { shouldFocus: true });
      return;
    }
    // Conflito: o ticket mudou, e o motivo já não vale para o que está lá.
    if (result.status === 409 || result.status === 404) onOpenChange(false);
    onFailure(ticket, result);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="compact"
        title={`Cancelar ${protocol}?`}
        description={ticket.title}
        onSubmit={(event) => void handleSubmit(onValid)(event)}
        footer={
          <ModalFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              Cancelar ticket
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-reason`}>
              <span>
                Motivo do cancelamento<span className="text-primary" aria-hidden> *</span>
              </span>
            </FieldLabel>
            <Textarea
              id={`${fieldId}-reason`}
              rows={3}
              maxLength={500}
              aria-required
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? `${fieldId}-reason-error` : undefined}
              {...register("reason")}
            />
            <FieldError id={`${fieldId}-reason-error`} className="text-xs">
              {errors.reason?.message}
            </FieldError>
          </Field>
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
