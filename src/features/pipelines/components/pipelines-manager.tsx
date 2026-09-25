"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  KanbanIcon,
  LayersIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getColorStyle } from "@/features/leads/schemas/colors";
import { PipelineFormDialog } from "@/features/pipelines/components/pipeline-form-dialog";
import {
  isLeadsPipeline,
  type Pipeline,
  type PipelineStage,
  type PipelineSummary,
} from "@/features/pipelines/types";
import { cn } from "@/lib/utils";

type PipelinesManagerProps = {
  pipelines: PipelineSummary[];
  /**
   * Etapas de **todos** os funis, como o banco devolve (`getBoardColumns`). O
   * agrupamento por funil é feito aqui: uma consulta só para a tela inteira
   * evita uma ida ao servidor a cada clique em "Editar", e o formulário precisa
   * da lista pronta no momento em que abre — ele semeia o estado na abertura.
   */
  stages: PipelineStage[];
};

/**
 * Gestão de funis (aba "Funis" das Configurações).
 *
 * Cada funil é um cartão: identidade (cor, nome, descrição) e tamanho (quantas
 * etapas, quantos cards). O funil nativo de leads aparece junto dos demais —
 * esconder o funil mais usado da clínica da tela que lista funis seria mentir
 * sobre o que existe — mas com selo "Nativo" e **sem** a ação de arquivar: o
 * servidor recusa (409), e oferecer um botão que só sabe falhar é pior do que
 * não oferecê-lo.
 */
export function PipelinesManager({ pipelines, stages }: PipelinesManagerProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Pipeline | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Pipeline | null>(null);
  const [archiving, setArchiving] = useState(false);

  const stagesByPipeline = useMemo(() => {
    const grouped = new Map<string, PipelineStage[]>();
    for (const stage of stages) {
      const list = grouped.get(stage.pipeline_id);
      if (list) list.push(stage);
      else grouped.set(stage.pipeline_id, [stage]);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return grouped;
  }, [stages]);

  const editingStages = editing ? (stagesByPipeline.get(editing.id) ?? []) : [];

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(item: PipelineSummary) {
    // O formulário substitui a lista inteira de etapas ao salvar. Abrir sem as
    // etapas reais faria o campo nascer com as três sugeridas — e salvar
    // apagaria o funil de verdade. Nesse caso, erro explícito e nada abre.
    const known = stagesByPipeline.get(item.pipeline.id) ?? [];
    if (item.stageCount > 0 && known.length === 0) {
      toast.error("Não foi possível carregar as etapas deste funil. Recarregue a página.");
      return;
    }
    setEditing(item.pipeline);
    setFormOpen(true);
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const response = await fetch(`/api/pipelines/${archiveTarget.id}`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível arquivar o funil.");
        return;
      }
      toast.success(result.message ?? "Funil arquivado.");
      setArchiveTarget(null);
      router.refresh();
    } catch {
      toast.error("Não foi possível arquivar o funil.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Mesma casca de cabeçalho das outras abas de Configurações
              (`text-sm font-semibold`, sem face de display): trocar de aba não
              pode trocar a tipografia do título. */}
          <h2 className="text-sm font-semibold">Funis e etapas</h2>
          <p className="text-sm text-muted-foreground">
            Cada funil tem as próprias etapas e os próprios cards. Use um para vendas, outro para
            processos internos — o card do funil personalizado nem precisa ter pessoa.
          </p>
        </div>
        <Button onClick={openCreate} className="h-11 sm:h-9">
          <PlusIcon data-icon="inline-start" />
          Novo funil
        </Button>
      </div>

      <div className="mt-5">
        {pipelines.length === 0 ? (
          <EmptyState>
            <span className="flex flex-col items-center gap-3">
              <span>Nenhum funil ainda. Crie o primeiro para começar a organizar o trabalho.</span>
              <Button type="button" variant="outline" size="sm" onClick={openCreate}>
                <PlusIcon data-icon="inline-start" />
                Novo funil
              </Button>
            </span>
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pipelines.map((item) => (
              <PipelineCard
                key={item.pipeline.id}
                item={item}
                onEdit={() => openEdit(item)}
                onArchive={() => setArchiveTarget(item.pipeline)}
              />
            ))}
          </ul>
        )}
      </div>

      <PipelineFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        pipeline={editing}
        stages={editingStages}
      />

      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(next) => {
          if (!next) setArchiveTarget(null);
        }}
      >
        <ModalShell
          size="compact"
          title="Arquivar funil"
          description={
            archiveTarget
              ? `"${archiveTarget.name}" sai da lista e do seletor do board. As etapas e os cards continuam gravados — nada é apagado.`
              : undefined
          }
          footer={
            <ModalFooterActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setArchiveTarget(null)}
                disabled={archiving}
                className="h-11 sm:h-9"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirmArchive}
                disabled={archiving}
                className="h-11 sm:h-9"
              >
                {archiving ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ArchiveIcon data-icon="inline-start" />
                )}
                Arquivar funil
              </Button>
            </ModalFooterActions>
          }
        >
          <p className="text-sm text-muted-foreground">
            Para trazer o funil de volta é preciso reativá-lo no banco — não há botão de
            desarquivar na interface.
          </p>
        </ModalShell>
      </Dialog>
    </>
  );
}

function PipelineCard({
  item,
  onEdit,
  onArchive,
}: {
  item: PipelineSummary;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const { pipeline, stageCount, cardCount } = item;
  const style = getColorStyle(pipeline.color);
  const native = isLeadsPipeline(pipeline);

  return (
    <li className="min-w-0">
      <Card className="relative h-full gap-3">
        {/* Barra de acento com a cor do funil. Cor nunca é o único sinal: o
            nome e as pílulas de contagem dizem o mesmo em texto (UI.md §1.4). */}
        <span className={cn("absolute inset-y-0 left-0 w-1", style.bar)} aria-hidden />

        <CardHeader className="pl-5">
          {/* `CardTitle` já traz a face de display (`font-heading`). */}
          <CardTitle className="flex min-w-0 items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-full", style.dot)} aria-hidden />
            <span className="truncate">{pipeline.name}</span>
          </CardTitle>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-11 text-muted-foreground sm:size-8"
                    aria-label={`Ações de ${pipeline.name}`}
                  />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onEdit}>
                  <PencilIcon />
                  Editar funil
                </DropdownMenuItem>
                {native ? null : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="min-h-11 sm:min-h-8"
                      variant="destructive"
                      onClick={onArchive}
                    >
                      <ArchiveIcon />
                      Arquivar funil
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>

        <CardContent className="grid gap-3 pl-5">
          <p className="line-clamp-2 min-h-8 text-sm text-muted-foreground">
            {pipeline.description?.trim() || "Sem descrição."}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1 rounded-full font-normal">
              <LayersIcon aria-hidden />
              {stageCount} {stageCount === 1 ? "etapa" : "etapas"}
            </Badge>
            <Badge variant="outline" className="gap-1 rounded-full font-normal">
              <KanbanIcon aria-hidden />
              {cardCount} {cardCount === 1 ? "card" : "cards"}
            </Badge>
            {native ? (
              <Badge variant="secondary" className="gap-1 rounded-full">
                <LockIcon aria-hidden />
                Nativo
              </Badge>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onEdit} className="h-11 sm:h-8">
              <PencilIcon data-icon="inline-start" />
              Editar
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
