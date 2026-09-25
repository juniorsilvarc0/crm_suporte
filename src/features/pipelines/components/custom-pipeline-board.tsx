"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  InboxIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
  type DragEndEvent,
} from "@/components/kibo-ui/kanban";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PipelineCardDialog } from "@/features/pipelines/components/pipeline-card-dialog";
import { getColorStyle } from "@/features/leads/schemas/colors";
import type { PipelineStage } from "@/features/pipelines/types";
import { formatDate, formatShortDate } from "@/lib/formatters/date";
import { formatMoney } from "@/lib/formatters/money";
import { cn } from "@/lib/utils";

/**
 * Card de funil personalizado, como o board precisa dele.
 *
 * Estrutural e permissivo de propósito: uma linha crua de `pipeline_cards`
 * já satisfaz o tipo, e um card enriquecido com a pessoa vinculada também.
 * Lead e paciente são **opcionais** — card de processo interno não tem pessoa,
 * e o título é quem identifica o cartão.
 */
export type PipelineBoardCard = {
  id: string;
  /** `key` de uma etapa DESTE funil. */
  stage: string;
  title: string;
  description?: string | null;
  amount?: number | null;
  due_at?: string | null;
  lead?: { name: string | null } | null;
  patient?: { full_name: string | null } | null;
};

type Card = { id: string; name: string; column: string; card: PipelineBoardCard };

function toCards(cards: PipelineBoardCard[]): Card[] {
  return cards.map((card) => ({
    id: card.id,
    name: card.title,
    column: card.stage,
    card,
  }));
}

/** Pessoa vinculada, quando existe. Sem pessoa o título é quem identifica. */
function personNameOf(card: PipelineBoardCard) {
  return card.patient?.full_name ?? card.lead?.name ?? null;
}

export function CustomPipelineBoard({
  pipelineId,
  stages,
  cards,
}: {
  pipelineId: string;
  /** Etapas do funil, em ordem. Cada uma vira uma coluna do kanban. */
  stages: PipelineStage[];
  cards: PipelineBoardCard[];
}) {
  const router = useRouter();
  // O cadastro de card mora aqui: a página é server component e não pode
  // passar função. Abre já na etapa da coluna clicada.
  const [creatingStage, setCreatingStage] = useState<string | null>(null);
  const onCreate = (stage: string) => setCreatingStage(stage);
  const [items, setItems] = useState<Card[]>(() => toCards(cards));
  // Cards com a etapa sendo gravada: sem isso o card muda de coluna sem
  // confirmar nada e não dá para saber se salvou.
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());

  // Re-sincroniza quando o servidor revalida (ajuste durante o render).
  const [syncedCards, setSyncedCards] = useState(cards);
  if (cards !== syncedCards) {
    setSyncedCards(cards);
    setItems(toCards(cards));
  }

  // Coluna de origem no início do arraste. O Kanban (handleDragOver) reatribui
  // `column` para o destino DURANTE o arraste, então só a origem capturada no
  // dragStart diz se houve troca de etapa de verdade.
  const dragOriginRef = useRef<string | null>(null);

  // Etapa órfã (card numa `key` que não é mais coluna do funil) cai numa coluna
  // "Sem etapa" em vez de sumir do board.
  const knownKeys = new Set(stages.map((stage) => stage.key));
  const orphanKeys = Array.from(
    new Set(items.map((item) => item.column).filter((key) => !knownKeys.has(key)))
  );
  const providerColumns = [
    ...stages.map((stage) => ({ id: stage.key, name: stage.label, color: stage.color })),
    ...orphanKeys.map((key) => ({ id: key, name: "Sem etapa", color: "slate" })),
  ];
  const columnByKey = new Map(providerColumns.map((column) => [column.id, column]));

  function markSaving(cardId: string, saving: boolean) {
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  }

  async function persistStage(cardId: string, stage: string) {
    markSaving(cardId, true);
    try {
      const res = await fetch(`/api/pipeline-cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const result = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível mover o card.");
        // Reverte para o que o servidor ainda tem.
        setItems(toCards(cards));
        return;
      }
      toast.success(`Movido para "${columnByKey.get(stage)?.name ?? stage}".`);
      router.refresh();
    } catch {
      toast.error("Não foi possível mover o card.");
      setItems(toCards(cards));
    } finally {
      markSaving(cardId, false);
    }
  }

  // Caminho do menu "Mover para": o arraste nunca é o único caminho (UI.md
  // §5.2). Move na tela primeiro, grava depois.
  function moveCard(cardId: string, stage: string) {
    setItems((current) =>
      current.map((item) => (item.id === cardId ? { ...item, column: stage } : item))
    );
    persistStage(cardId, stage);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!over) return;

    const overColumn =
      columnByKey.get(String(over.id))?.id ??
      items.find((item) => item.id === over.id)?.column;

    // Compara com a ORIGEM: durante o arraste o `column` do card já foi
    // reatribuído para o destino, e comparar com ele daria sempre "igual".
    if (!overColumn || !origin || overColumn === origin) return;
    persistStage(active.id as string, overColumn);
  }

  // Funil sem etapa nenhuma não é board: é configuração faltando, e dizer isso
  // vale mais que desenhar uma faixa vazia.
  if (stages.length === 0) {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20 p-8 text-center">
        <div className="grid justify-items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <InboxIcon className="size-5" aria-hidden />
          </span>
          <div className="grid gap-1">
            <p className="font-display text-sm font-medium">Este funil ainda não tem etapas</p>
            <p className="max-w-xs text-xs leading-snug text-muted-foreground">
              Sem etapas não há para onde arrastar um card. Crie as etapas nas
              configurações do funil.
            </p>
          </div>
          <Link
            href="/app/configuracoes"
            className="flex h-9 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <SlidersHorizontalIcon className="size-4" aria-hidden />
            Gerenciar funis
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <KanbanProvider
        columns={providerColumns}
        data={items}
        onDragStart={(event) => {
          dragOriginRef.current =
            items.find((item) => item.id === event.active.id)?.column ?? null;
        }}
        onDataChange={setItems}
        onDragEnd={handleDragEnd}
        className="h-full"
      >
        {(column) => {
          const style = getColorStyle(column.color as string);
          const total = items.filter((item) => item.column === column.id).length;

          return (
            // A cor da etapa tinge a COLUNA inteira; o card fica neutro e usa a
            // mesma cor só como aro fino (UI.md §5.2).
            <KanbanBoard id={column.id} key={column.id} className={style.panel}>
              <KanbanHeader className="flex items-center justify-between gap-2 border-b border-border/60 bg-card/70 px-3 py-3 backdrop-blur-sm">
                <span className={cn("flex min-w-0 items-center gap-2", style.text)}>
                  <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden />
                  <span className="truncate text-xs font-semibold tracking-wide uppercase">
                    {column.name as string}
                  </span>
                  {/* Pílula, não círculo: com 3+ dígitos o número cresce na horizontal. */}
                  <span
                    className={cn(
                      "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-background px-1.5 text-[11px] font-semibold tabular-nums ring-1",
                      style.ring,
                      style.text
                    )}
                  >
                    {total}
                  </span>
                </span>
                
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Novo card em ${column.name}`}
                    onClick={() => onCreate(column.id as string)}
                    className="size-11 shrink-0 text-muted-foreground hover:text-foreground sm:size-8"
                  >
                    <PlusIcon />
                  </Button>
              </KanbanHeader>

              <KanbanCards
                id={column.id}
                empty={
                  // Coluna vazia sem nada é área morta (UI.md §5.2).
                  <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-border/70 bg-background/60 px-4 py-6 text-center">
                    <div className="grid justify-items-center gap-2">
                      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <InboxIcon className="size-4" aria-hidden />
                      </span>
                      <div className="grid gap-1">
                        <p className="text-sm font-medium">Sem cards aqui</p>
                        <p className="max-w-44 text-xs leading-snug text-muted-foreground">
                          Arraste um card para esta etapa
                          {" ou crie um novo direto nela."}
                        </p>
                      </div>
                      
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onCreate(column.id as string)}
                        >
                          <PlusIcon data-icon="inline-start" />
                          Novo card
                        </Button>
                    </div>
                  </div>
                }
              >
                {(item: Card) => {
                  const columnStyle = getColorStyle(columnByKey.get(item.column)?.color);
                  const person = personNameOf(item.card);
                  const isSaving = savingIds.has(item.id);

                  return (
                    <KanbanCard
                      key={item.id}
                      id={item.id}
                      name={item.name}
                      column={item.column}
                      className={cn(
                        "group/card relative overflow-hidden border-transparent bg-card p-0 shadow-none ring-1 ring-inset transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                        columnStyle.ring,
                        isSaving && "pointer-events-none"
                      )}
                    >
                      {/* Gravando a etapa: o card fica ocupado e diz isso. */}
                      {isSaving ? (
                        <span
                          className="absolute inset-0 z-20 grid place-items-center bg-card/70"
                          role="status"
                          aria-label={`Salvando ${item.name}`}
                        >
                          <Loader2Icon
                            className="size-4 animate-spin text-muted-foreground"
                            aria-hidden
                          />
                        </span>
                      ) : null}

                      {/*
                        `grid-cols-[minmax(0,1fr)]` é obrigatório: sem isso a
                        trilha vira `max-content` e texto longo vaza do card em
                        vez de truncar.
                      */}
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 p-3 pr-12">
                        <span className="flex items-start justify-between gap-2">
                          <span className="line-clamp-2 min-w-0 text-sm leading-snug font-semibold">
                            {item.card.title}
                          </span>
                          {item.card.amount !== null && item.card.amount !== undefined ? (
                            <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                              {formatMoney(item.card.amount)}
                            </span>
                          ) : null}
                        </span>

                        {/* Card de processo interno não tem pessoa — e tudo bem. */}
                        {person ? (
                          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <UserRoundIcon className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{person}</span>
                          </span>
                        ) : null}

                        {item.card.description ? (
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {item.card.description}
                          </span>
                        ) : null}

                        {item.card.due_at ? (
                          <span
                            className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
                            title={`Prazo: ${formatDate(item.card.due_at)}`}
                          >
                            <CalendarDaysIcon className="size-3 shrink-0" aria-hidden />
                            <span className="sr-only">Prazo:</span>
                            {formatShortDate(item.card.due_at)}
                          </span>
                        ) : null}
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="absolute top-1 right-1 z-10 size-11 bg-card/90 text-muted-foreground opacity-100 hover:text-foreground sm:top-2 sm:right-2 sm:size-8 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-visible:opacity-100"
                              aria-label={`Ações de ${item.name}`}
                            />
                          }
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Mover para</DropdownMenuLabel>
                            {/*
                              Só etapas REAIS do funil: a coluna "Sem etapa" é
                              um abrigo de leitura para card órfão, e o gatilho
                              do banco recusaria a gravação nela.
                            */}
                            {stages
                              .filter((target) => target.key !== item.column)
                              .map((target) => (
                                <DropdownMenuItem
                                  key={target.id}
                                  className="min-h-11 sm:min-h-8"
                                  onClick={() => moveCard(item.id, target.key)}
                                >
                                  <ArrowRightIcon />
                                  <span className="truncate">{target.label}</span>
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </KanbanCard>
                  );
                }}
              </KanbanCards>
            </KanbanBoard>
          );
        }}
      </KanbanProvider>

      <PipelineCardDialog
        open={creatingStage !== null}
        onOpenChange={(next) => { if (!next) setCreatingStage(null); }}
        pipelineId={pipelineId}
        stages={stages.map((stage) => ({ key: stage.key, label: stage.label, color: stage.color }))}
        stage={creatingStage ?? undefined}
        onSaved={() => setCreatingStage(null)}
      />
    </div>
  );
}
