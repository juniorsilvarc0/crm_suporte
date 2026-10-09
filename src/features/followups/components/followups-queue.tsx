"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClockIcon, Loader2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  ActiveFilters,
  DataToolbar,
  FilterButton,
  FilterField,
} from "@/components/data-display/data-toolbar";
import { EmptyState } from "@/components/data-display/empty-state";
import { FormSelect } from "@/components/forms/form-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import { followupKindColor, followupKindLabel } from "@/features/followups/lib/followup-kind";
import {
  followupStatusColor,
  followupStatusLabel,
  type FollowupStatus,
} from "@/features/followups/lib/followup-status";
import {
  FOLLOWUP_QUEUE_SITUATIONS,
  type FollowupQueueItem,
  type FollowupQueueParams,
  type FollowupQueueSituation,
  type FollowupsQueuePage,
} from "@/features/followups/types";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { useNow } from "@/features/tickets/hooks/use-now";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { formatDateTime } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

const BASE_PATH = "/app/follow-ups";

const SITUATION_OPTIONS: ReadonlyArray<{ value: FollowupQueueSituation; label: string }> = [
  { value: "pendentes", label: "Pendentes" },
  { value: "vencidos", label: "Vencidos" },
  { value: "concluidos", label: "Concluídos" },
  { value: "cancelados", label: "Cancelados" },
  { value: "todos", label: "Todos" },
];

const RESPONSIBLE_OPTIONS: ReadonlyArray<{ value: FollowupQueueParams["responsavel"]; label: string }> = [
  { value: "todos", label: "Todos os tickets" },
  { value: "eu", label: "Meus tickets" },
];

// Como a contagem chama o recorte: "3 retornos pendentes".
const SITUATION_NOUN: Record<FollowupQueueSituation, [string, string]> = {
  pendentes: ["retorno pendente", "retornos pendentes"],
  vencidos: ["retorno vencido", "retornos vencidos"],
  concluidos: ["retorno concluído", "retornos concluídos"],
  cancelados: ["retorno cancelado", "retornos cancelados"],
  todos: ["retorno", "retornos"],
};

function toSituation(value: string): FollowupQueueSituation {
  return FOLLOWUP_QUEUE_SITUATIONS.find((situation) => situation === value) ?? "pendentes";
}

/** URL da fila com os filtros; `page` sempre sai — filtro novo volta à página 1. */
function followupsHref(situacao: FollowupQueueSituation, responsavel: FollowupQueueParams["responsavel"]) {
  const search = new URLSearchParams();
  if (situacao !== "pendentes") search.set("situacao", situacao);
  if (responsavel !== "todos") search.set("responsavel", responsavel);
  const query = search.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

/**
 * A fila de retornos, cruzando tickets (/app/follow-ups). A página é do
 * servidor e a URL é a fonte da verdade: situação e responsável viram
 * `?situacao=` e `?responsavel=`. Concluir, cancelar e reabrir são PATCH
 * diretos, como na ficha do ticket; editar e excluir ficam lá.
 */
export function FollowupsQueue({ page, params }: { page: FollowupsQueuePage; params: FollowupQueueParams }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const now = useNow(page.fetchedAt);
  const nowMs = now.getTime();

  const currentHref = followupsHref(params.situacao, params.responsavel);
  const [situacao, setSituacao] = useState(params.situacao);
  const [responsavel, setResponsavel] = useState(params.responsavel);
  // Navegações pedidas por esta tela que a URL ainda não refletiu, em ordem.
  const [pushed, setPushed] = useState<string[]>([]);
  const [seenHref, setSeenHref] = useState(currentHref);

  // A URL mudou. Se foi esta tela que pediu, os filtros já estão certos (ou à
  // frente, com uma segunda troca feita durante o carregamento). Se veio de
  // fora (o item do menu, com a fila aberta), eles acompanham a URL.
  if (currentHref !== seenHref) {
    setSeenHref(currentHref);
    const index = pushed.indexOf(currentHref);
    if (index >= 0) {
      setPushed(pushed.slice(index + 1));
    } else {
      setPushed([]);
      setSituacao(params.situacao);
      setResponsavel(params.responsavel);
    }
  }

  const navigate = useCallback(
    (href: string) => {
      setPushed((list) => [...list, href]);
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [router]
  );

  const targetHref = pushed.length > 0 ? pushed[pushed.length - 1] : currentHref;

  function changeFilters(nextSituacao: FollowupQueueSituation, nextResponsavel: FollowupQueueParams["responsavel"]) {
    setSituacao(nextSituacao);
    setResponsavel(nextResponsavel);
    const href = followupsHref(nextSituacao, nextResponsavel);
    if (href !== targetHref) navigate(href);
  }

  function clearFilters() {
    changeFilters("pendentes", "todos");
  }

  function retry() {
    startTransition(() => router.refresh());
  }

  const [busyId, setBusyId] = useState<string | null>(null);

  async function patchStatus(followup: FollowupQueueItem, status: FollowupStatus) {
    if (busyId) return;
    setBusyId(followup.id);
    try {
      const response = await fetch(`/api/followups/${followup.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        toast.error(result.message ?? "Não foi possível atualizar o retorno.");
        return;
      }
      toast.success(
        status === "concluido" ? "Retorno concluído." : status === "cancelado" ? "Retorno cancelado." : "Retorno reaberto."
      );
      startTransition(() => router.refresh());
    } catch {
      toast.error("Não foi possível atualizar o retorno.");
    } finally {
      setBusyId(null);
    }
  }

  const activeFilterCount = Number(situacao !== "pendentes") + Number(responsavel !== "todos");
  const filtered = params.situacao !== "pendentes" || params.responsavel !== "todos";
  const { items, total } = page;
  const [singular, plural] = SITUATION_NOUN[params.situacao];
  const countText = page.failed ? "" : `${total} ${total === 1 ? singular : plural}`;

  const isOverdue = (followup: FollowupQueueItem) =>
    followup.status === "pendente" && new Date(followup.due_at).getTime() < nowMs;

  const rowActions = (followup: FollowupQueueItem) => {
    const rowBusy = busyId === followup.id;
    return (
      <div className="flex shrink-0 items-center justify-end gap-1">
        {followup.status === "pendente" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyId !== null}
              onClick={() => void patchStatus(followup, "concluido")}
              className="h-11 text-primary sm:h-8"
            >
              {rowBusy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              Concluir
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyId !== null}
              onClick={() => void patchStatus(followup, "cancelado")}
              className="h-11 text-muted-foreground sm:h-8"
            >
              Cancelar
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busyId !== null}
            onClick={() => void patchStatus(followup, "pendente")}
            className="h-11 text-muted-foreground sm:h-8"
          >
            {rowBusy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            Reabrir
          </Button>
        )}
      </div>
    );
  };

  return (
    <section aria-labelledby="followups-title" className="space-y-3">
      <div>
        <h1 id="followups-title" className="font-display text-2xl font-semibold tracking-tight">
          Retornos
        </h1>
        <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground tabular-nums">
          {countText}
        </p>
      </div>

      {/* A barra nunca some: nem na fila vazia, nem na que falhou. */}
      <DataToolbar>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <FilterButton activeCount={activeFilterCount}>
            <FilterField label="Situação">
              <FormSelect
                aria-label="Filtrar por situação"
                value={situacao}
                onValueChange={(value) => changeFilters(toSituation(value), responsavel)}
                options={SITUATION_OPTIONS}
              />
            </FilterField>
            <FilterField label="Tickets">
              <FormSelect
                aria-label="Filtrar por responsável do ticket"
                value={responsavel}
                onValueChange={(value) => changeFilters(situacao, value === "eu" ? "eu" : "todos")}
                options={RESPONSIBLE_OPTIONS}
              />
            </FilterField>
          </FilterButton>
          <ActiveFilters count={activeFilterCount} onClear={clearFilters} />
        </div>
      </DataToolbar>

      <div aria-busy={isPending || undefined} className={cn("transition-opacity", isPending && "opacity-60")}>
        {page.failed ? (
          <EmptyState>
            <span className="flex flex-col items-center gap-3">
              <span>Não foi possível carregar os retornos.</span>
              <Button type="button" variant="outline" onClick={retry} disabled={isPending} className="h-11 sm:h-9">
                {isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Tentar de novo
              </Button>
            </span>
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>
            {filtered ? (
              <span className="flex flex-col items-center gap-3">
                <span>Nenhum retorno encontrado.</span>
                <Button type="button" variant="outline" onClick={clearFilters} className="h-11 sm:h-9">
                  <XIcon data-icon="inline-start" />
                  Limpar
                </Button>
              </span>
            ) : (
              "Nenhum retorno pendente. Retornos nascem na ficha do ticket."
            )}
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20 shadow-soft">
            <div className="hidden px-2 pb-2 md:block">
              <Table variant="cards" className="table-fixed">
                <TableHeader>
                  <TableRow variant="cards-header">
                    <TableHead className="w-44 pl-3 sm:pl-4">Prazo</TableHead>
                    <TableHead className="w-28">Tipo</TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead className="hidden w-[22%] lg:table-cell">Empresa</TableHead>
                    <TableHead className="w-28">Situação</TableHead>
                    <TableHead className="w-48">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((followup) => (
                    <TableRow key={followup.id} variant="card">
                      <TableCell className="py-3 pl-3 sm:pl-4">
                        <DueAt followup={followup} overdue={isOverdue(followup)} />
                      </TableCell>
                      <TableCell>
                        <KindBadge followup={followup} />
                      </TableCell>
                      <TableCell className="max-w-0 py-3">
                        <TicketCell followup={followup} />
                      </TableCell>
                      <TableCell className="hidden max-w-0 truncate text-sm lg:table-cell">
                        {followup.ticket.customer ? (
                          customerDisplayName(followup.ticket.customer)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge followup={followup} />
                      </TableCell>
                      <TableCell className="pr-2">{rowActions(followup)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-2 p-2 md:hidden">
              {items.map((followup) => {
                const overdue = isOverdue(followup);
                return (
                  <article
                    key={followup.id}
                    // `grid-cols-[minmax(0,1fr)]`: sem trilha declarada o texto
                    // longo vaza em vez de truncar (UI.md §9).
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border bg-card px-4 py-3",
                      overdue ? "border-destructive/40" : "border-border/70"
                    )}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <KindBadge followup={followup} />
                      <StatusBadge followup={followup} />
                      <DueAt followup={followup} overdue={overdue} />
                    </div>
                    <div className="min-w-0">
                      <TicketCell followup={followup} />
                    </div>
                    {followup.ticket.customer ? (
                      <p className="min-w-0 truncate text-xs text-muted-foreground">
                        {customerDisplayName(followup.ticket.customer)}
                      </p>
                    ) : null}
                    <div className="-mx-2 -mb-1">{rowActions(followup)}</div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DueAt({ followup, overdue }: { followup: FollowupQueueItem; overdue: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm tabular-nums",
        overdue ? "font-medium text-destructive" : "text-muted-foreground"
      )}
    >
      {overdue ? (
        <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
      )}
      {formatDateTime(followup.due_at)}
      {overdue ? " · vencido" : ""}
    </span>
  );
}

function KindBadge({ followup }: { followup: FollowupQueueItem }) {
  return (
    <Badge variant="outline" className={getColorStyle(followupKindColor[followup.kind]).badge}>
      {followupKindLabel[followup.kind]}
    </Badge>
  );
}

function StatusBadge({ followup }: { followup: FollowupQueueItem }) {
  return (
    <Badge variant="outline" className={getColorStyle(followupStatusColor[followup.status]).badge}>
      {followupStatusLabel[followup.status]}
    </Badge>
  );
}

function TicketCell({ followup }: { followup: FollowupQueueItem }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
      <p className="flex min-w-0 items-baseline gap-2 text-sm">
        <Link
          href={`/app/tickets/${followup.ticket.number}`}
          className="shrink-0 rounded-sm font-medium tabular-nums text-primary outline-none underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {formatProtocol(followup.ticket.number)}
        </Link>
        <span className="truncate">{followup.ticket.title}</span>
      </p>
      {followup.notes?.trim() ? (
        <p className="truncate text-xs text-muted-foreground">{followup.notes.trim()}</p>
      ) : null}
    </div>
  );
}
