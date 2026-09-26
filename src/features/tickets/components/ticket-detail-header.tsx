"use client";

import { useId, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  ArrowLeftIcon,
  CopyIcon,
  CrosshairIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCwIcon,
  UserRoundCogIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import { SlaBadge } from "@/features/tickets/components/sla-badge";
import { TicketPriorityBadge } from "@/features/tickets/components/ticket-priority-badge";
import {
  TicketStatusBadge,
  type TicketStatusBadgeValue,
} from "@/features/tickets/components/ticket-status-badge";
import type { TicketFailure, TicketMutation } from "@/features/tickets/hooks/use-ticket-mutation";
import { canTransition } from "@/features/tickets/lib/state-machine";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import {
  quickActions,
  ticketStatusLabel,
  type TicketQuickAction,
} from "@/features/tickets/lib/ticket-actions";
import {
  ticketPatchSchema,
  ticketTransitionSchema,
  type TicketPatchInput,
  type TicketPatchValues,
  type TicketTransitionInput,
  type TicketTransitionValues,
} from "@/features/tickets/schemas/ticket";
import type {
  ActiveTicketData,
  TicketDetail,
  TicketStatusOption,
  TicketTransition,
  TransitionTicketData,
} from "@/features/tickets/types";
import { formatDateTime } from "@/lib/formatters/date";

// Mesmo teto do schema (e de tickets_title_check).
const TITLE_MAX_LENGTH = 200;
const REASON_MAX_LENGTH = 500;

export type TicketDetailHeaderProps = {
  ticket: TicketDetail;
  status: TicketStatusBadgeValue;
  statuses: TicketStatusOption[] | null;
  transitions: TicketTransition[] | null;
  viewerId: string;
  now: Date;
  mutation: TicketMutation;
  /** Abre o diálogo "Atribuir" (o mesmo do Responsável na lateral). */
  onAssign: () => void;
};

export function ticketUrl(ticketId: string, action?: string): string {
  const base = `/api/tickets/${encodeURIComponent(ticketId)}`;
  return action ? `${base}/${action}` : base;
}

export function chatHref(conversationId: string): string {
  return `/app/chat?conversation=${encodeURIComponent(conversationId)}`;
}

/**
 * A linha de fatos: Aberto em · 1ª resposta · Solução. Só instantes que o
 * banco tem; o prazo da solução só aparece com o relógio correndo (pausado, o
 * prazo gravado ainda vai mudar na retomada).
 */
export function ticketFacts(ticket: TicketDetail): string[] {
  const stopped = ticket.sla_mode === "stopped";
  const firstResponse = ticket.first_responded_at
    ? `1ª resposta em ${formatDateTime(ticket.first_responded_at)}`
    : stopped
      ? "Sem 1ª resposta"
      : `1ª resposta até ${formatDateTime(ticket.first_response_due_at)}`;

  let solution: string;
  if (ticket.resolved_at) solution = `Resolvido em ${formatDateTime(ticket.resolved_at)}`;
  else if (ticket.status === "cancelado" && ticket.closed_at) {
    solution = `Cancelado em ${formatDateTime(ticket.closed_at)}`;
  } else if (ticket.sla_mode === "running") {
    solution = `Solução até ${formatDateTime(ticket.resolution_due_at)}`;
  } else solution = "Solução pausada";

  return [`Aberto em ${formatDateTime(ticket.created_at)}`, firstResponse, solution];
}

/**
 * Cabeçalho do detalhe (spec 4b): protocolo com "Copiar", título editável,
 * selos de status, prioridade e SLA, a linha de fatos e as ações —
 * "Responder no WhatsApp", as ações rápidas (`quickActions`) e o menu ⋯
 * (Atribuir, Pôr em foco, Copiar protocolo, Cancelar com motivo, na própria
 * página). Ticket encerrado não edita: o banco responderia TICKET_TERMINAL.
 */
export function TicketDetailHeader({
  ticket,
  status,
  statuses,
  transitions,
  viewerId,
  now,
  mutation,
  onAssign,
}: TicketDetailHeaderProps) {
  const router = useRouter();
  const protocol = formatProtocol(ticket.number);
  const terminal = ticket.is_terminal;
  const [editingTitle, setEditingTitle] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // 409 `already_assigned` do Atender: quem está com o ticket (nome pode faltar).
  const [takenBy, setTakenBy] = useState<{ name: string | null } | null>(null);

  const actions = quickActions(ticket, transitions, viewerId);
  const canCancel = canTransition(transitions, ticket.status, "cancelado");
  const canFocus = !ticket.in_focus && !terminal;
  const { busy, pendingKey } = mutation;

  async function copyProtocol() {
    try {
      await navigator.clipboard.writeText(protocol);
      toast.success("Protocolo copiado.");
    } catch {
      toast.error("Não foi possível copiar o protocolo.");
    }
  }

  function focusRequest(key: string) {
    return {
      key,
      url: `/api/chat/conversations/${encodeURIComponent(ticket.conversation_id)}/active-ticket`,
      method: "PUT" as const,
      body: { ticket_id: ticket.id },
    };
  }

  const focusedMessage = (data: ActiveTicketData) =>
    data.changed ? `${protocol} agora está em foco na conversa.` : null;

  // Encerrado não entra em foco (409): só abre a conversa. Em foco, também.
  async function replyOnWhatsApp() {
    const href = chatHref(ticket.conversation_id);
    if (ticket.in_focus || terminal) {
      router.push(href);
      return;
    }
    const ok = await mutation.run<ActiveTicketData>(focusRequest("reply"), {
      success: focusedMessage,
      refresh: false,
    });
    if (ok) router.push(href);
  }

  function takeOver(reassign: boolean) {
    void mutation.run(
      {
        key: "take_over",
        url: ticketUrl(ticket.id, "take-over"),
        method: "POST",
        body: reassign ? { reassign: true } : {},
      },
      {
        success: () => `Você assumiu ${protocol}.`,
        onSuccess: () => setTakenBy(null),
        onFailure: (failure: TicketFailure) => {
          if (failure.body?.code !== "already_assigned") return false;
          setTakenBy({ name: failure.body.assigned_to_name ?? null });
          // A tela está velha (outro analista pegou): relê. O painel é estado
          // daqui e continua de pé.
          mutation.refresh();
          return true;
        },
      }
    );
  }

  function runQuickAction(action: TicketQuickAction) {
    if (action.kind === "take_over") {
      takeOver(false);
      return;
    }
    const label = ticketStatusLabel(action.to, statuses);
    void mutation.run<TransitionTicketData>(
      {
        key: action.id,
        url: ticketUrl(ticket.id, "transition"),
        method: "POST",
        body: { to: action.to, version: ticket.version },
      },
      { success: (data) => (data.changed ? `${protocol} movido para ${label}.` : null) }
    );
  }

  return (
    <header className="space-y-3">
      <Link
        href="/app/tickets"
        className="-ms-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Tickets
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="font-mono text-sm font-medium tabular-nums text-muted-foreground">
              {protocol}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void copyProtocol()}
              aria-label={`Copiar o protocolo ${protocol}`}
              className="h-11 px-2 text-muted-foreground sm:h-7"
            >
              <CopyIcon data-icon="inline-start" />
              Copiar
            </Button>
          </div>

          {editingTitle ? (
            <TicketTitleForm
              ticket={ticket}
              mutation={mutation}
              onClose={() => setEditingTitle(false)}
            />
          ) : (
            <div className="flex min-w-0 items-start gap-1">
              <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                {ticket.title}
              </h1>
              {terminal ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => setEditingTitle(true)}
                  aria-label="Editar título"
                  className="mt-0.5 size-11 shrink-0 text-muted-foreground sm:mt-1 sm:size-8"
                >
                  <PencilIcon />
                </Button>
              )}
            </div>
          )}

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0">
              <TicketStatusBadge status={status} />
            </div>
            <div className="min-w-0">
              <TicketPriorityBadge priority={ticket.priority} />
            </div>
            <div className="min-w-0">
              <SlaBadge ticket={ticket} now={now} />
            </div>
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground tabular-nums">
            {ticketFacts(ticket).map((fact, index) => (
              <li key={fact} className="flex items-center gap-3">
                {index > 0 ? <span aria-hidden>·</span> : null}
                {fact}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:max-w-md lg:items-end">
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void replyOnWhatsApp()}
              className="h-11 w-full sm:h-9 sm:w-auto"
            >
              {pendingKey === "reply" ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                // O ícone tem nome próprio ("WhatsApp"): fora do nome do botão.
                <span aria-hidden data-icon="inline-start" className="inline-flex">
                  <WhatsAppIcon className="size-4" />
                </span>
              )}
              {terminal ? "Abrir conversa" : "Responder no WhatsApp"}
            </Button>
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => runQuickAction(action)}
                className="h-11 flex-1 sm:h-9 sm:flex-none"
              >
                {pendingKey === action.id ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : null}
                {action.label}
              </Button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={busy}
                    aria-label={`Mais ações de ${protocol}`}
                    className="size-11 shrink-0 sm:size-9"
                  />
                }
              >
                {pendingKey === "focus" || pendingKey === "cancel" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <MoreHorizontalIcon />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 p-1.5">
                {terminal ? null : (
                  <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onAssign}>
                    <UserRoundCogIcon />
                    Atribuir…
                  </DropdownMenuItem>
                )}
                {canFocus ? (
                  <DropdownMenuItem
                    className="min-h-11 sm:min-h-8"
                    onClick={() =>
                      void mutation.run<ActiveTicketData>(focusRequest("focus"), {
                        success: focusedMessage,
                      })
                    }
                  >
                    <CrosshairIcon />
                    Pôr em foco na conversa
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={() => void copyProtocol()}>
                  <CopyIcon />
                  Copiar protocolo
                </DropdownMenuItem>
                {canCancel ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="min-h-11 sm:min-h-8"
                      onClick={() => setCancelling(true)}
                    >
                      <XIcon />
                      Cancelar ticket…
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Sem a matriz, as ações de status somem: a falha não pode parecer
              "sem ações" (a tela não inventa as transições). */}
          {transitions === null && !terminal ? (
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground lg:justify-end">
              <p>Não foi possível carregar as ações de status.</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={mutation.refreshing}
                onClick={mutation.refresh}
                className="h-11 px-2 text-primary sm:h-8"
              >
                {mutation.refreshing ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <RotateCwIcon data-icon="inline-start" />
                )}
                Tentar de novo
              </Button>
            </div>
          ) : null}

          {takenBy ? (
            <div
              role="alert"
              className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm lg:text-right"
            >
              <p>
                {takenBy.name ? `${protocol} está com ${takenBy.name}.` : `${protocol} já está com outro analista.`}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row lg:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setTakenBy(null)}
                  className="h-11 sm:h-8"
                >
                  Deixar como está
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => takeOver(true)}
                  className="h-11 sm:h-8"
                >
                  {pendingKey === "take_over" ? (
                    <Loader2Icon className="animate-spin" data-icon="inline-start" />
                  ) : null}
                  Assumir mesmo assim
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {cancelling ? (
        <CancelTicketPanel
          ticket={ticket}
          statuses={statuses}
          mutation={mutation}
          onClose={() => setCancelling(false)}
        />
      ) : null}
    </header>
  );
}

/**
 * Título editável: react-hook-form com o MESMO schema do PATCH (UI.md §5.23).
 * Manda só o título e a versão que a tela tem; o mesmo título de novo nem sai.
 * Enter salva, Esc desiste.
 */
function TicketTitleForm({
  ticket,
  mutation,
  onClose,
}: {
  ticket: TicketDetail;
  mutation: TicketMutation;
  onClose: () => void;
}) {
  const fieldId = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TicketPatchValues, unknown, TicketPatchInput>({
    resolver: zodResolver(ticketPatchSchema),
    defaultValues: { version: ticket.version, title: ticket.title },
  });
  const saving = mutation.pendingKey === "title";

  async function onValid(values: TicketPatchInput) {
    if (values.title === undefined || values.title === ticket.title) {
      onClose();
      return;
    }
    await mutation.run(
      {
        key: "title",
        url: ticketUrl(ticket.id),
        method: "PATCH",
        body: { version: ticket.version, title: values.title },
      },
      {
        success: () => "Título atualizado.",
        onSuccess: onClose,
        onFailure: (failure) => {
          const message = failure.body?.errors?.title?.[0];
          if (!message) return false;
          setError("title", { type: "server", message }, { shouldFocus: true });
          return true;
        },
      }
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <form
      noValidate
      aria-busy={saving}
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      className="mt-1 grid max-w-3xl gap-2"
    >
      <Field>
        <FieldLabel htmlFor={`${fieldId}-title`} className="sr-only">
          Título do ticket
        </FieldLabel>
        <Input
          id={`${fieldId}-title`}
          autoFocus
          maxLength={TITLE_MAX_LENGTH}
          disabled={saving}
          onKeyDown={onKeyDown}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${fieldId}-title-error` : undefined}
          className="h-11 font-display text-lg font-semibold md:text-lg"
          {...register("title")}
        />
        <FieldError id={`${fieldId}-title-error`} className="text-xs">
          {errors.title?.message}
        </FieldError>
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onClose}
          className="h-11 sm:h-8"
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.busy} className="h-11 sm:h-8">
          {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          Salvar título
        </Button>
      </div>
    </form>
  );
}

/**
 * "Cancelar ticket" pede o motivo na própria página (confirmação inline, molde
 * do encerrar contrato): a rota exige o motivo e a RPC confere de novo. Mesmo
 * schema da rota, então sem motivo nada sai daqui.
 */
function CancelTicketPanel({
  ticket,
  statuses,
  mutation,
  onClose,
}: {
  ticket: TicketDetail;
  statuses: TicketStatusOption[] | null;
  mutation: TicketMutation;
  onClose: () => void;
}) {
  const fieldId = useId();
  const id = (part: string) => `${fieldId}-${part}`;
  const protocol = formatProtocol(ticket.number);
  const sending = mutation.pendingKey === "cancel";

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TicketTransitionValues, unknown, TicketTransitionInput>({
    resolver: zodResolver(ticketTransitionSchema),
    defaultValues: { to: "cancelado", version: ticket.version, reason: "" },
  });

  async function onValid(values: TicketTransitionInput) {
    const label = ticketStatusLabel("cancelado", statuses);
    await mutation.run<TransitionTicketData>(
      {
        key: "cancel",
        url: ticketUrl(ticket.id, "transition"),
        method: "POST",
        body: { to: "cancelado", version: ticket.version, reason: values.reason },
      },
      {
        success: (data) => (data.changed ? `${protocol} movido para ${label}.` : null),
        onSuccess: onClose,
        onFailure: (failure) => {
          const message = failure.body?.errors?.reason?.[0];
          if (!message) {
            // O ticket mudou ou já não cancela: o motivo não vale mais para ele.
            if (failure.status === 409 || failure.status === 404) onClose();
            return false;
          }
          setError("reason", { type: "server", message }, { shouldFocus: true });
          return true;
        },
      }
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={id("title")}
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:p-4"
    >
      <form
        noValidate
        aria-busy={sending}
        onSubmit={(event) => void handleSubmit(onValid)(event)}
        className="grid gap-3"
      >
        <div>
          <p id={id("title")} className="text-sm font-medium">
            Cancelar {protocol}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cancelado é definitivo: o ticket sai da fila e não volta a ser atendido.
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor={id("reason")} className="text-xs">
            <span>
              Motivo do cancelamento<span className="text-primary" aria-hidden> *</span>
            </span>
          </FieldLabel>
          <Textarea
            id={id("reason")}
            rows={3}
            autoFocus
            maxLength={REASON_MAX_LENGTH}
            disabled={sending}
            aria-required
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? id("reason-error") : undefined}
            className="bg-background"
            {...register("reason")}
          />
          <FieldError id={id("reason-error")} className="text-xs">
            {errors.reason?.message}
          </FieldError>
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={sending}
            onClick={onClose}
            className="h-11 sm:h-9"
          >
            Voltar
          </Button>
          <Button type="submit" variant="destructive" disabled={mutation.busy} className="h-11 sm:h-9">
            {sending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            Cancelar ticket
          </Button>
        </div>
      </form>
    </div>
  );
}
