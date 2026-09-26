"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeftIcon,
  ChevronUpIcon,
  CircleDotIcon,
  CrosshairIcon,
  LinkIcon,
  Loader2Icon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PaperclipIcon,
  PencilIcon,
  RotateCwIcon,
  StickyNoteIcon,
  TicketIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { noteAuthorLabel } from "@/features/chat/lib/note-actions";
import {
  TicketCommentComposer,
  TicketCommentEditForm,
} from "@/features/tickets/components/ticket-comment-composer";
import { ticketAttachmentHref } from "@/features/tickets/lib/attachment-view";
import {
  authorLabel,
  canDeleteComment,
  canEditComment,
} from "@/features/tickets/lib/comment-actions";
import { compareInstants, isTimelineInstant } from "@/features/tickets/lib/ticket-timeline";
import {
  buildTimelinePeople,
  commentToTimelineItem,
  eventLines,
  mergeTimelineItems,
  messageSenderLabel,
  messageSummary,
  readTimelinePage,
  statusChangeText,
  timelineItemKey,
  trailActorLabel,
  type TimelineCatalog,
  type TimelinePeople,
} from "@/features/tickets/lib/timeline-view";
import type {
  TicketComment,
  TicketTimelinePage,
  TimelineAttachmentItem,
  TimelineCommentItem,
  TimelineEventItem,
  TimelineItem,
  TimelineMessageItem,
  TimelineStatusItem,
} from "@/features/tickets/types";
import { formatBytes } from "@/lib/formatters/bytes";
import { formatDateTime } from "@/lib/formatters/date";
import { cn } from "@/lib/utils";

export type TicketTimelineProps = {
  ticketId: string;
  conversationId: string;
  viewerId: string;
  /** A equipe (id e nome), para assinar a trilha e as notas. */
  users: ReadonlyArray<{ id: string; name: string }>;
  /**
   * A 1ª página, lida pela página do servidor (getTicketTimeline). `null` = a
   * leitura falhou. Passe o objeto como veio do servidor: cada objeto NOVO (o
   * `router.refresh()`) é juntado ao que a tela já tem, sem perder as páginas
   * anteriores já carregadas.
   */
  initial: TicketTimelinePage | null;
  /**
   * Opcional: rótulos de status do admin e nomes de fila e categoria (o
   * catálogo do detalhe serve direto). Sem ele, rótulos de recurso e frases
   * genéricas ("Fila alterada").
   */
  catalog?: TimelineCatalog | null;
};

type Cursor = { hasMore: boolean; nextBefore: string | null };

// Qual nota está sendo editada ou esperando a confirmação de apagar: uma por vez.
type CommentAction = { id: string; mode: "edit" | "delete" };

/**
 * A 1ª página nova (o refresh) deixa um buraco na tela? Sim quando ela tem
 * mais atrás e o item mais antigo dela é posterior ao mais novo da 1ª página
 * anterior: entraram mais atividades que uma página desde então, e as do meio
 * não vieram. A régua é a página anterior, não a lista: a nota que a rota
 * acabou de devolver é mais nova que tudo e esconderia o buraco. Sem a página
 * anterior (o refresh dela falhou) não dá para saber, e conta como buraco.
 */
function leavesGap(next: TicketTimelinePage, previous: TicketTimelinePage | null): boolean {
  if (!next.hasMore || !next.nextBefore || !isTimelineInstant(next.nextBefore)) return false;
  const newest = mergeTimelineItems([], previous?.items ?? []).at(-1);
  return !newest || compareInstants(next.nextBefore, newest.at) > 0;
}

/**
 * Timeline do ticket (spec 4b): status, eventos, notas do ticket, notas e
 * mensagens do WhatsApp e anexos numa lista só, do mais antigo para o mais
 * novo, com "Carregar anteriores" no topo e a nota nova embaixo.
 *
 * Sem Realtime: a página do servidor manda a 1ª página, e cada ação faz o
 * `router.refresh()`. A nota que a rota devolve entra na hora; a página nova
 * que o refresh traz é juntada sem duplicar.
 *
 * Quatro estados: carregando (tentar de novo depois da falha), falha, vazio e
 * lista. Sem teto de altura: a página rola, não a timeline.
 */
export function TicketTimeline({
  ticketId,
  conversationId,
  viewerId,
  users,
  initial,
  catalog = null,
}: TicketTimelineProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const people = useMemo(() => buildTimelinePeople(users, viewerId), [users, viewerId]);

  const [items, setItems] = useState<TimelineItem[]>(() =>
    mergeTimelineItems([], initial?.items ?? [])
  );
  // Cursor da página mais antiga já carregada. `null` = o cursor é o da 1ª
  // página (que o refresh atualiza): no começo, e depois de um refresh que
  // deixou buraco (leavesGap).
  const [olderCursor, setOlderCursor] = useState<Cursor | null>(null);
  // Página nova do servidor (o refresh): junta durante o render, o mesmo
  // ajuste de estado por prop do primitivo Dialog. Nada se perde: o que a
  // página nova deixou de fora continua na lista, e o trecho que ela não
  // alcançou volta a ser pedido por "Carregar anteriores".
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (initial) {
      if (olderCursor && leavesGap(initial, seenInitial)) setOlderCursor(null);
      setItems(mergeTimelineItems(items, initial.items));
    }
  }

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const loadingOlderRef = useRef(false);
  const [action, setAction] = useState<CommentAction | null>(null);

  const cursor: Cursor | null =
    olderCursor ?? (initial ? { hasMore: initial.hasMore, nextBefore: initial.nextBefore } : null);
  const olderBefore = cursor?.hasMore ? cursor.nextBefore : null;

  function refresh() {
    startRefresh(() => router.refresh());
  }

  function receive(incoming: TimelineItem[]) {
    setItems((current) => mergeTimelineItems(current, incoming));
  }

  async function loadOlder() {
    if (loadingOlderRef.current || !olderBefore) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      // URLSearchParams, nunca o instante colado na URL: o "+" do fuso chegaria
      // à rota como espaço, e ela recusaria o cursor.
      const query = new URLSearchParams({ before: olderBefore });
      const response = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/timeline?${query.toString()}`
      );
      const page = response.ok ? readTimelinePage(await response.json().catch(() => null)) : null;
      if (!page) {
        setOlderFailed(true);
        return;
      }
      receive(page.items);
      setOlderCursor({ hasMore: page.hasMore, nextBefore: page.nextBefore });
    } catch {
      setOlderFailed(true);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  function onCommentSaved(comment: TicketComment) {
    receive([commentToTimelineItem(comment)]);
    setAction(null);
    refresh();
  }

  const failed = initial === null;
  let body: ReactNode;
  if (items.length === 0 && failed) {
    body = refreshing ? (
      <TicketTimelineSkeleton />
    ) : (
      <EmptyState>
        <div className="grid justify-items-center gap-3">
          <p>Não foi possível carregar a linha do tempo.</p>
          <RetryButton onRetry={refresh} />
        </div>
      </EmptyState>
    );
  } else if (items.length === 0) {
    body = <EmptyState>Nenhuma atividade registrada ainda.</EmptyState>;
  } else {
    body = (
      <ol aria-label="Linha do tempo do ticket" className="ms-3 border-s border-border/70">
        {items.map((item) => (
          <TimelineEntry
            key={timelineItemKey(item)}
            item={item}
            ticketId={ticketId}
            conversationId={conversationId}
            people={people}
            catalog={catalog}
            action={action}
            onAction={setAction}
            onCommentSaved={onCommentSaved}
            onStale={refresh}
          />
        ))}
      </ol>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      {failed && items.length > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1 text-destructive">
            Não foi possível atualizar a linha do tempo.
          </span>
          <RetryButton onRetry={refresh} pending={refreshing} />
        </div>
      ) : null}

      {olderBefore ? (
        <div className="flex flex-col items-start gap-2">
          {olderFailed ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar as atividades anteriores.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
            className="h-11 sm:h-8"
          >
            {loadingOlder ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : olderFailed ? (
              <RotateCwIcon data-icon="inline-start" />
            ) : (
              <ChevronUpIcon data-icon="inline-start" />
            )}
            {olderFailed ? "Tentar de novo" : "Carregar anteriores"}
          </Button>
        </div>
      ) : null}

      {body}

      <TicketCommentComposer
        ticketId={ticketId}
        onCreated={(comment) => {
          receive([commentToTimelineItem(comment)]);
          toast.success("Nota adicionada.");
          refresh();
        }}
        onStale={refresh}
      />
    </div>
  );
}

/** A geometria da timeline enquanto ela carrega (e no `loading.tsx` do detalhe). */
export function TicketTimelineSkeleton() {
  return (
    <div role="status" aria-label="Carregando a linha do tempo" className="ms-3 border-s border-border/70">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="relative ps-6 pb-5 last:pb-0">
          <Skeleton className="absolute -start-3 top-0 size-6 rounded-full" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="mt-2 h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function RetryButton({ onRetry, pending = false }: { onRetry: () => void; pending?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={onRetry}
      className="h-11 sm:h-8"
    >
      {pending ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <RotateCwIcon data-icon="inline-start" />
      )}
      Tentar de novo
    </Button>
  );
}

type EntryProps = {
  item: TimelineItem;
  ticketId: string;
  conversationId: string;
  people: TimelinePeople;
  catalog: TimelineCatalog | null;
  action: CommentAction | null;
  onAction: (action: CommentAction | null) => void;
  onCommentSaved: (comment: TicketComment) => void;
  onStale: () => void;
};

// O ícone do marcador, pelo tipo do item. Elemento pronto, não componente
// escolhido no render (react-hooks/static-components).
function EntryIcon({ item }: { item: TimelineItem }) {
  const className = "size-3.5";
  switch (item.kind) {
    case "status":
      return <ArrowRightLeftIcon className={className} />;
    case "event":
      switch (item.event_type) {
        case "ticket.created":
          return <TicketIcon className={className} />;
        case "ticket.assigned":
          return <UserRoundIcon className={className} />;
        case "ticket.focused":
        case "ticket.unfocused":
          return <CrosshairIcon className={className} />;
        case "ticket.messages_linked":
          return <LinkIcon className={className} />;
        case "ticket.updated":
          return <PencilIcon className={className} />;
        default:
          return <CircleDotIcon className={className} />;
      }
    case "comment":
      return <StickyNoteIcon className={className} />;
    case "message":
      return item.type === "note" ? (
        <NotebookPenIcon className={className} />
      ) : (
        <MessageCircleIcon className={className} />
      );
    case "attachment":
      return <PaperclipIcon className={className} />;
  }
}

function TimelineEntry(props: EntryProps) {
  const { item } = props;

  let content: ReactNode;
  switch (item.kind) {
    case "status":
      content = <StatusEntry {...props} item={item} />;
      break;
    case "event":
      content = <EventEntry {...props} item={item} />;
      break;
    case "comment":
      content = <CommentEntry {...props} item={item} />;
      break;
    case "message":
      content =
        item.type === "note" ? (
          <ChatNoteEntry {...props} item={item} />
        ) : (
          <MessageEntry {...props} item={item} />
        );
      break;
    case "attachment":
      content = <AttachmentEntry {...props} item={item} />;
      break;
  }

  return (
    <li className="relative min-w-0 ps-6 pb-5 last:pb-0" data-kind={item.kind}>
      <span
        aria-hidden
        className="absolute -start-3 top-0 flex size-6 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground"
      >
        <EntryIcon item={item} />
      </span>
      {content}
    </li>
  );
}

/** "Ana · 26/09/2026 14:32". Sem quem, só o instante. */
function EntryMeta({ who, at }: { who: string | null; at: string }) {
  return (
    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
      {who ? (
        <>
          <span className="min-w-0 truncate">{who}</span>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <time dateTime={at} className="tabular-nums">
        {formatDateTime(at)}
      </time>
    </p>
  );
}

function StatusEntry({
  item,
  people,
  catalog,
}: EntryProps & { item: TimelineStatusItem }) {
  return (
    <div className="min-w-0">
      <p className="break-words text-sm font-medium">
        {statusChangeText(item, catalog?.statuses ?? null)}
      </p>
      {item.reason ? (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          Motivo: {item.reason}
        </p>
      ) : null}
      <EntryMeta who={trailActorLabel(item, people)} at={item.at} />
    </div>
  );
}

function EventEntry({ item, people, catalog }: EntryProps & { item: TimelineEventItem }) {
  const lines = eventLines(item, people, catalog);
  return (
    <div className="min-w-0">
      {lines.map((line, index) => (
        <p key={index} className="break-words text-sm">
          {line}
        </p>
      ))}
      <EntryMeta who={trailActorLabel(item, people)} at={item.at} />
    </div>
  );
}

function CommentEntry({
  item,
  ticketId,
  people,
  action,
  onAction,
  onCommentSaved,
  onStale,
}: EntryProps & { item: TimelineCommentItem }) {
  const author = authorLabel(item, people.names, people.viewerId);
  const deleted = item.deleted_at !== null;
  const canEdit = canEditComment(item, people.viewerId);
  const canDelete = canDeleteComment(item, people.viewerId);
  const mine = action?.id === item.id ? action.mode : null;

  return (
    <article className="min-w-0 rounded-lg border border-border/60 bg-card px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 pt-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Nota do ticket</span>
          {author ? (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{author}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <time dateTime={item.at} className="tabular-nums">
            {formatDateTime(item.at)}
          </time>
          {item.edited_at && !deleted ? (
            <>
              <span aria-hidden>·</span>
              <span>editada</span>
            </>
          ) : null}
        </p>
        {(canEdit || canDelete) && mine === null ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Ações da nota"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "-me-1.5 -mt-0.5 size-11 shrink-0 text-muted-foreground sm:size-7"
              )}
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              {canEdit ? (
                <DropdownMenuItem
                  className="min-h-11 sm:min-h-8"
                  onClick={() => onAction({ id: item.id, mode: "edit" })}
                >
                  <PencilIcon data-icon="inline-start" />
                  Editar
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem
                  variant="destructive"
                  className="min-h-11 sm:min-h-8"
                  onClick={() => onAction({ id: item.id, mode: "delete" })}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Apagar
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {deleted ? (
        <p className="mt-1 text-sm italic text-muted-foreground">Nota apagada</p>
      ) : mine === "edit" ? (
        <div className="mt-2">
          <TicketCommentEditForm
            ticketId={ticketId}
            comment={item}
            onSaved={(comment) => {
              toast.success("Nota atualizada.");
              onCommentSaved(comment);
            }}
            onCancel={() => onAction(null)}
            onStale={onStale}
          />
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.body}</p>
      )}

      {mine === "delete" && !deleted ? (
        <DeleteConfirmation
          ticketId={ticketId}
          commentId={item.id}
          onDeleted={(comment) => {
            toast.success("Nota apagada.");
            onCommentSaved(comment);
          }}
          onCancel={() => onAction(null)}
          onStale={onStale}
        />
      ) : null}
    </article>
  );
}

/**
 * Confirmação na própria nota (UI.md §6), sem modal. A frase diz a verdade: a
 * nota some para toda a equipe, e o cliente nunca a viu.
 */
function DeleteConfirmation({
  ticketId,
  commentId,
  onDeleted,
  onCancel,
  onStale,
}: {
  ticketId: string;
  commentId: string;
  onDeleted: (comment: TicketComment) => void;
  onCancel: () => void;
  onStale: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleting = useRef(false);

  async function confirm() {
    if (deleting.current) return;
    deleting.current = true;
    setPending(true);
    setError(null);
    const failure = "Não foi possível apagar a nota.";
    try {
      const response = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}`,
        { method: "DELETE" }
      );
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        comment?: TicketComment;
      };
      if (!response.ok || !result.ok || !result.comment) {
        setError(result.message ?? failure);
        if (response.status === 404 || response.status === 409) onStale();
        return;
      }
      onDeleted(result.comment);
    } catch {
      setError(failure);
    } finally {
      deleting.current = false;
      setPending(false);
    }
  }

  return (
    <div
      role="group"
      aria-label="Confirmar exclusão da nota"
      className="mt-2 grid gap-2 rounded-md bg-destructive/5 p-2"
    >
      <p className="text-sm">Apagar esta nota? Ela some para toda a equipe.</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onCancel}
          className="h-11 sm:h-8"
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => void confirm()}
          className="h-11 sm:h-8"
        >
          {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          Apagar nota
        </Button>
      </div>
    </div>
  );
}

/** Link para a conversa, esticado sobre a entrada inteira (alvo de toque grande). */
function ConversationLink({ conversationId }: { conversationId: string }) {
  return (
    <Link
      href={`/app/chat?conversation=${encodeURIComponent(conversationId)}`}
      className="font-medium text-primary outline-none underline-offset-4 after:absolute after:inset-0 after:rounded-md hover:underline focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
    >
      ver na conversa
    </Link>
  );
}

function ChatNoteEntry({
  item,
  conversationId,
  people,
}: EntryProps & { item: TimelineMessageItem }) {
  const author = noteAuthorLabel(item, people.names, people.viewerId);
  return (
    <article className="relative min-w-0 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Nota no chat</span>
        {author ? (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate">{author}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <time dateTime={item.at} className="tabular-nums">
          {formatDateTime(item.at)}
        </time>
        <span aria-hidden>·</span>
        <ConversationLink conversationId={conversationId} />
      </p>
      {item.is_deleted ? (
        <p className="mt-1 text-sm italic text-muted-foreground">Nota apagada</p>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.content}</p>
      )}
    </article>
  );
}

function MessageEntry({
  item,
  conversationId,
  people,
}: EntryProps & { item: TimelineMessageItem }) {
  const summary = messageSummary(item);
  // Quem da equipe mandou (a mensagem guarda sent_by_user_id): a mesma
  // assinatura da nota do chat — "Você", o nome, ou nenhuma.
  const signer =
    item.sender_type === "agent" ? noteAuthorLabel(item, people.names, people.viewerId) : null;
  const sender = signer ? `${messageSenderLabel(item)} · ${signer}` : messageSenderLabel(item);
  const failedToSend = item.direction === "outbound" && item.delivery_status === "failed";

  return (
    <div className="relative min-w-0 rounded-md">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{sender}</span>
        <span aria-hidden>·</span>
        <time dateTime={item.at} className="tabular-nums">
          {formatDateTime(item.at)}
        </time>
        {failedToSend ? (
          <>
            <span aria-hidden>·</span>
            <span className="text-destructive">Não enviada</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <ConversationLink conversationId={conversationId} />
      </p>
      {summary.deleted ? (
        <p className="mt-0.5 text-sm italic text-muted-foreground">Mensagem apagada</p>
      ) : (
        <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm">
          {summary.media ? (
            <span className="font-medium">
              {summary.media}
              {summary.text ? ": " : ""}
            </span>
          ) : null}
          {summary.text ?? (summary.media ? null : "Mensagem sem texto")}
        </p>
      )}
    </div>
  );
}

function AttachmentEntry({
  item,
  ticketId,
  people,
}: EntryProps & { item: TimelineAttachmentItem }) {
  const uploader = authorLabel(
    { author_user_id: item.uploaded_by_user_id, author_token_id: item.uploaded_by_token_id },
    people.names,
    people.viewerId
  );
  const size = formatBytes(item.size_bytes);
  return (
    <div className="min-w-0">
      <p className="break-words text-sm">
        Anexo:{" "}
        <a
          href={ticketAttachmentHref(ticketId, item.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-medium text-primary underline-offset-4 hover:underline"
        >
          {item.file_name}
        </a>
        {size ? <span className="text-muted-foreground"> · {size}</span> : null}
      </p>
      <EntryMeta who={uploader} at={item.at} />
    </div>
  );
}
