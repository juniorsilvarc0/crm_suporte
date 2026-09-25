"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  STAGE_TYPES,
  stageTypeLabel,
  toStageType,
  type StageType,
} from "@/features/board/schemas/stage";
import { getColorStyle, isColorName, type ColorName } from "@/features/tags/schemas/colors";
import type { Pipeline, PipelineStage } from "@/features/pipelines/types";
import { cn } from "@/lib/utils";

/** Teto do `pipelineStagesSchema` — a tela não deixa passar do que a rota aceita. */
const MAX_STAGES = 20;

type PipelineFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = edição. Ausente = funil novo. */
  pipeline?: Pipeline | null;
  /** Etapas atuais do funil em edição, em ordem. Vazio = usa as sugeridas. */
  stages?: PipelineStage[];
};

type MutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  pipeline?: { id?: string } | null;
  id?: string;
};

/** Etapa dentro do formulário. Sem `id` = etapa nova, que a rota vai criar. */
type StageDraft = {
  /** Chave de lista só do React — some no envio. */
  uid: string;
  id?: string;
  label: string;
  color: ColorName;
  stageType: StageType;
};

/**
 * Funil novo nasce com um processo mínimo já montado, para o usuário renomear.
 * Espelha `DEFAULT_PIPELINE_STAGES` (`features/pipelines/schemas/pipeline.ts`),
 * que é o que a rota grava quando o formulário não manda etapa nenhuma — as
 * duas listas precisam dizer a mesma coisa para a tela não prometer um funil
 * diferente do que o servidor cria.
 */
const SUGGESTED_STAGES: ReadonlyArray<Omit<StageDraft, "uid">> = [
  { label: "A fazer", color: "slate", stageType: "open" },
  { label: "Em andamento", color: "sky", stageType: "open" },
  { label: "Concluído", color: "emerald", stageType: "won" },
];

function toColorName(value: string | null | undefined): ColorName {
  return value && isColorName(value) ? value : "sky";
}

/**
 * Chave de lista do React para uma etapa.
 *
 * Não dá para usar o índice: a lista é reordenável, e com chave por posição o
 * React reaproveita o `<input>` errado ao mover uma etapa — o texto fica numa
 * linha e o cursor em outra. Um contador em `useRef` seria lido durante o
 * render (o estado inicial é semeado ali), o que a regra `react-hooks/refs`
 * proíbe; daí o identificador vir de uma função pura.
 */
function newStageUid(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `stage-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

/** Etapas do funil como o formulário as edita — ou as sugeridas, se não houver. */
function buildStages(source: PipelineStage[] | undefined): StageDraft[] {
  if (source && source.length > 0) {
    return source.map((stage) => ({
      uid: newStageUid(),
      id: stage.id,
      label: stage.label,
      color: toColorName(stage.color),
      stageType: toStageType(stage.stage_type),
    }));
  }
  return SUGGESTED_STAGES.map((stage) => ({ ...stage, uid: newStageUid() }));
}

/**
 * Cadastro do funil: identidade (nome, descrição, cor) e o desenho das etapas.
 *
 * As etapas são **estado do React**, não campos do `<form>`: a lista é
 * reordenável e cresce sob demanda, e ordem é justamente o que `FormData` não
 * sabe representar. O resto do formulário segue o padrão não-controlado do
 * projeto (`Object.fromEntries(new FormData())`), com a cor entrando por um
 * campo escondido.
 *
 * O salvamento muda de forma conforme o caso, seguindo o que cada rota garante:
 *
 * - **Criar** é um pedido só (`POST /api/pipelines` com `stages`): a rota grava
 *   funil e etapas juntos e apaga o funil se as etapas falharem. Não existe
 *   meio-caminho para a tela ter que explicar.
 * - **Editar** são dois (`PATCH /api/pipelines/{id}` e depois
 *   `PUT /api/pipelines/{id}/stages` com a lista completa), porque o segundo
 *   pode ser recusado sozinho: remover etapa que ainda tem card volta 409, e
 *   essa mensagem precisa aparecer com o modal aberto, ao lado da lista que a
 *   causou.
 */
export function PipelineFormDialog({
  open,
  onOpenChange,
  pipeline,
  stages: initialStages,
}: PipelineFormDialogProps) {
  const router = useRouter();
  const fieldId = useId();
  const submitting = useRef(false);

  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  /** Erro que vale para a lista inteira — inclusive o 409 de etapa com cards. */
  const [stagesError, setStagesError] = useState<string | null>(null);
  const [color, setColor] = useState<ColorName>(toColorName(pipeline?.color));
  const [stages, setStages] = useState<StageDraft[]>(() => buildStages(initialStages));

  // Reabrir o modal recomeça do zero: erro e rascunho de etapa da tentativa
  // anterior não podem sobreviver ao fechamento — o corpo desmonta com o
  // diálogo, mas este componente continua montado. Ajuste durante o render,
  // mesmo padrão de `PatientFormDialog`.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setErrors({});
      setStagesError(null);
      setColor(toColorName(pipeline?.color));
      setStages(buildStages(initialStages));
    }
  }

  const isEdit = Boolean(pipeline);
  const isNative = pipeline?.kind === "leads";
  const id = (field: string) => `${fieldId}-${field}`;
  const errorId = (field: string) => (errors[field] ? `${id(field)}-error` : undefined);

  function updateStage(uid: string, patch: Partial<Omit<StageDraft, "uid">>) {
    setStages((current) =>
      current.map((stage) => (stage.uid === uid ? { ...stage, ...patch } : stage))
    );
  }

  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    setStages((current) => {
      const next = current.slice();
      const moved = next[target];
      next[target] = next[index];
      next[index] = moved;
      return next;
    });
  }

  function removeStage(uid: string) {
    setStages((current) => current.filter((stage) => stage.uid !== uid));
  }

  function addStage() {
    setStages((current) =>
      current.length >= MAX_STAGES
        ? current
        : [...current, { uid: newStageUid(), label: "", color: "slate", stageType: "open" }]
    );
  }

  /** Primeiro problema local da lista, ou `null` se ela estiver pronta. */
  function validateStages(): string | null {
    if (stages.length === 0) return "Um funil precisa de pelo menos uma etapa.";
    if (stages.some((stage) => stage.label.trim() === "")) {
      return "Toda etapa precisa de um nome.";
    }
    // A chave da etapa é derivada do rótulo e é única por funil: dois rótulos
    // iguais colidiriam no banco, e o erro voltaria sem dizer qual foi.
    const seen = new Set<string>();
    for (const stage of stages) {
      const normalized = stage.label.trim().toLocaleLowerCase("pt-BR");
      if (seen.has(normalized)) return `Há duas etapas chamadas "${stage.label.trim()}".`;
      seen.add(normalized);
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const stageProblem = validateStages();
    if (stageProblem) {
      setStagesError(stageProblem);
      toast.error(stageProblem);
      return;
    }

    submitting.current = true;
    setPending(true);
    setErrors({});
    setStagesError(null);

    const payload = Object.fromEntries(new FormData(event.currentTarget));
    // Lista completa e na ordem da tela: a posição do item É a posição da
    // coluna. `id` ausente = etapa nova; presente = a rota atualiza a linha e
    // preserva a `key` para a qual os cards já apontam.
    const stagePayload = stages.map((stage, index) => ({
      ...(stage.id ? { id: stage.id } : {}),
      label: stage.label.trim(),
      color: stage.color,
      stage_type: stage.stageType,
      position: index,
    }));

    try {
      if (!pipeline) {
        // Criação é UM pedido: `POST /api/pipelines` grava funil e etapas
        // juntos e desfaz o funil se as etapas falharem. Criar primeiro e
        // mandar as etapas depois abriria uma janela em que existe um funil
        // com as etapas erradas — e o usuário não tem como saber disso.
        const response = await fetch("/api/pipelines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, stages: stagePayload }),
        });
        const result = (await response.json().catch(() => ({}))) as MutationResponse;

        if (!response.ok || !result.ok) {
          setErrors(result.errors ?? {});
          if (result.errors?.stages?.[0]) setStagesError(result.errors.stages[0]);
          toast.error(result.message ?? "Não foi possível criar o funil.");
          return;
        }

        toast.success(result.message ?? "Funil criado.");
        router.refresh();
        onOpenChange(false);
        return;
      }

      // Edição: identidade primeiro, etapas depois. Separadas porque a segunda
      // pode ser recusada sozinha — remover etapa que ainda tem card volta 409.
      const response = await fetch(`/api/pipelines/${pipeline.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as MutationResponse;

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar o funil.");
        return;
      }

      const stagesResponse = await fetch(`/api/pipelines/${pipeline.id}/stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: stagePayload }),
      });
      const stagesResult = (await stagesResponse.json().catch(() => ({}))) as MutationResponse;

      if (!stagesResponse.ok || !stagesResult.ok) {
        // 409 = etapa removida que ainda tem cards. A mensagem do servidor diz
        // qual etapa é; trocá-la por um "não foi possível" genérico apagaria a
        // única informação que resolve o problema.
        const message =
          stagesResult.message ??
          (stagesResponse.status === 409
            ? "Uma das etapas que você removeu ainda tem cards. Mova os cards antes de excluí-la."
            : "As etapas não foram salvas.");
        setErrors(stagesResult.errors ?? {});
        setStagesError(message);
        toast.error(message);
        // Nome, descrição e cor já foram gravados pelo PATCH acima — a lista
        // atrás do modal precisa mostrar isso, mesmo com as etapas recusadas.
        router.refresh();
        return;
      }

      toast.success(stagesResult.message ?? "Funil atualizado.");
      router.refresh();
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar o funil.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ModalShell
        size="medium"
        className="sm:max-w-2xl"
        title={isEdit ? "Editar funil" : "Novo funil"}
        description={
          isEdit
            ? "Nome, cor e etapas valem para todos os cards deste funil."
            : "Dê um nome ao processo e ajuste as etapas sugeridas antes de salvar."
        }
        onSubmit={handleSubmit}
        footer={
          <ModalFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {isEdit ? "Salvar alterações" : "Criar funil"}
            </Button>
          </ModalFooterActions>
        }
      >
        {/* Trocar de funil com o modal aberto precisa refazer os campos:
            `defaultValue` só é lido na montagem. */}
        <div key={pipeline?.id ?? "new"} className="grid gap-6">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={id("name")} className="justify-between gap-3 text-xs">
                <span>
                  Nome do funil<span className="text-primary"> *</span>
                </span>
                {errors.name ? (
                  <span id={errorId("name")} className="font-normal text-destructive" role="alert">
                    {errors.name[0]}
                  </span>
                ) : null}
              </Label>
              <Input
                id={id("name")}
                name="name"
                required
                minLength={2}
                maxLength={60}
                autoComplete="off"
                placeholder="Ex.: Jornada do paciente"
                defaultValue={pipeline?.name ?? ""}
                // O servidor recusa renomear o funil nativo (409) — e esse 409
                // aborta o salvamento inteiro, levando junto as etapas que a
                // pessoa acabou de ajustar. Melhor não deixar digitar.
                readOnly={isNative}
                className={cn("h-11 sm:h-10", isNative && "text-muted-foreground")}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? errorId("name") : isNative ? id("name-hint") : undefined}
              />
              {isNative ? (
                <p id={id("name-hint")} className="text-xs text-muted-foreground">
                  O nome do funil nativo é fixo — ele aparece em relatório e no vocabulário da
                  equipe.
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={id("description")} className="justify-between gap-3 text-xs">
                <span>Descrição</span>
                {errors.description ? (
                  <span
                    id={errorId("description")}
                    className="font-normal text-destructive"
                    role="alert"
                  >
                    {errors.description[0]}
                  </span>
                ) : null}
              </Label>
              <Textarea
                id={id("description")}
                name="description"
                maxLength={240}
                placeholder="Para que serve este funil e quem trabalha nele."
                className="min-h-20 resize-y"
                defaultValue={pipeline?.description ?? ""}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errorId("description")}
              />
            </div>

            <div className="grid gap-1.5">
              <span className="text-xs font-medium">Cor do funil</span>
              {/* A cor é estado do React (a paleta não é um `<input>`), mas o
                  envio continua sendo por `FormData` como o resto do
                  formulário — daí o campo escondido. */}
              <input type="hidden" name="color" value={color} />
              <ColorSwatchPicker value={color} onChange={setColor} />
              {errors.color ? (
                <p className="text-xs text-destructive" role="alert">
                  {errors.color[0]}
                </p>
              ) : null}
            </div>
          </div>

          <section className="grid gap-3 border-t border-border/70 pt-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Etapas</h3>
                <p className="text-xs text-muted-foreground">
                  A ordem aqui é a ordem das colunas no board.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStage}
                disabled={pending || stages.length >= MAX_STAGES}
                className="h-11 sm:h-9"
              >
                <PlusIcon data-icon="inline-start" />
                Etapa
              </Button>
            </div>

            {isNative ? (
              <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Este é o funil nativo de leads. Probabilidade e “contar como conversão” de cada
                etapa continuam em Funil › Configurar funil.
              </p>
            ) : null}

            {stagesError ? (
              <Alert variant="destructive" className="border-destructive/40">
                <TriangleAlertIcon />
                <AlertTitle>Etapas não salvas</AlertTitle>
                <AlertDescription>{stagesError}</AlertDescription>
              </Alert>
            ) : null}

            {stages.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/80 px-4 py-6 text-center text-sm text-muted-foreground">
                Sem etapas, o funil não tem colunas. Adicione ao menos uma.
              </p>
            ) : (
              <ol className="overflow-hidden rounded-lg border border-border/70 bg-card">
                {stages.map((stage, index) => (
                  <li
                    key={stage.uid}
                    className="flex flex-wrap items-center gap-2 border-b border-border/70 px-2 py-2 last:border-b-0 sm:px-3"
                  >
                    <span
                      className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground"
                      aria-hidden
                    >
                      {index + 1}
                    </span>

                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={pending}
                            className="size-11 shrink-0 sm:size-9"
                            aria-label={`Cor da etapa ${stage.label.trim() || index + 1}`}
                          />
                        }
                      >
                        <span
                          className={cn("size-4 rounded-full", getColorStyle(stage.color).dot)}
                          aria-hidden
                        />
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-3">
                        <ColorSwatchPicker
                          value={stage.color}
                          onChange={(next) => updateStage(stage.uid, { color: next })}
                        />
                      </PopoverContent>
                    </Popover>

                    <Input
                      value={stage.label}
                      onChange={(event) => updateStage(stage.uid, { label: event.target.value })}
                      maxLength={40}
                      disabled={pending}
                      placeholder="Nome da etapa"
                      aria-label={`Nome da etapa ${index + 1}`}
                      className="h-11 min-w-36 flex-1 sm:h-9"
                    />

                    <FormSelect
                      value={stage.stageType}
                      onValueChange={(next) =>
                        updateStage(stage.uid, { stageType: toStageType(next) })
                      }
                      disabled={pending}
                      className="h-11 w-32 sm:h-9"
                      aria-label={`Situação da etapa ${index + 1}`}
                      options={STAGE_TYPES.map((type) => ({
                        value: type,
                        label: stageTypeLabel[type],
                      }))}
                    />

                    <div className="ml-auto flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Mover etapa ${index + 1} para cima`}
                        disabled={pending || index === 0}
                        onClick={() => moveStage(index, -1)}
                        className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Mover etapa ${index + 1} para baixo`}
                        disabled={pending || index === stages.length - 1}
                        onClick={() => moveStage(index, 1)}
                        className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remover etapa ${index + 1}`}
                        disabled={pending}
                        onClick={() => removeStage(stage.uid)}
                        className="size-11 text-muted-foreground hover:text-destructive sm:size-8"
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <p className="text-xs text-muted-foreground">
              {stages.length >= MAX_STAGES
                ? `Limite de ${MAX_STAGES} etapas por funil atingido.`
                : `Etapa marcada como ${stageTypeLabel.won} ou ${stageTypeLabel.lost} encerra o card; as demais seguem abertas.`}
            </p>
          </section>
        </div>
      </ModalShell>
    </Dialog>
  );
}
