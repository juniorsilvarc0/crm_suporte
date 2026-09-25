"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  GripVerticalIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  TargetIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/forms/form-select";
import { Label } from "@/components/ui/label";
import type { BoardColumn } from "@/features/board/types";
import {
  STAGE_TYPES,
  stageTypeColor,
  stageTypeLabel,
  toStageType,
  type StageType,
} from "@/features/board/schemas/stage";
import { getColorStyle, type ColorName } from "@/features/leads/schemas/colors";
import { cn } from "@/lib/utils";

type StagePayload = {
  label: string;
  color: ColorName;
  probability: number | null;
  stageType: StageType;
  countsAsConversion: boolean;
};

// Configuração do funil (etapas) num só lugar — estilo "Pipelines & Etapas":
// lista as etapas, reordena, renomeia, muda a cor, adiciona e remove. Um toggle
// opcional exibe a probabilidade (%) e a situação (Aberto/Ganho/Perdido).
export function FunnelSettingsDialog({
  columns,
  open,
  onOpenChange,
  showStageMeta = false,
}: {
  columns: BoardColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showStageMeta?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<BoardColumn[]>(columns);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metaOn, setMetaOn] = useState(showStageMeta);

  // Re-sincroniza com o servidor quando a página revalida (ajuste no render).
  const [synced, setSynced] = useState(columns);
  if (columns !== synced) {
    setSynced(columns);
    setItems(columns);
    setEditingId(null);
    setAdding(false);
  }
  const [syncedMeta, setSyncedMeta] = useState(showStageMeta);
  if (showStageMeta !== syncedMeta) {
    setSyncedMeta(showStageMeta);
    setMetaOn(showStageMeta);
  }

  async function toggleMeta(next: boolean) {
    setMetaOn(next); // otimista
    setBusy(true);
    try {
      const res = await fetch("/api/funnel-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showStageMeta: next }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar a preferência.");
        setMetaOn(!next);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar a preferência.");
      setMetaOn(!next);
    } finally {
      setBusy(false);
    }
  }

  async function reorder(next: BoardColumn[]) {
    const previous = items;
    setItems(next); // otimista
    setBusy(true);
    try {
      const res = await fetch("/api/board-columns/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map((c) => c.id) }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível reordenar.");
        setItems(previous);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Não foi possível reordenar.");
      setItems(previous);
    } finally {
      setBusy(false);
    }
  }

  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    void reorder(next);
  }

  async function saveStage(id: string | null, payload: StagePayload): Promise<boolean> {
    setBusy(true);
    try {
      const url = id ? `/api/board-columns/${id}` : "/api/board-columns";
      // Só envia probabilidade/situação quando o toggle está ligado — assim
      // editar nome/cor com o toggle desligado não sobrescreve esses metadados.
      const body: Record<string, unknown> = {
        label: payload.label,
        color: payload.color,
        // Sempre enviado: o campo está sempre visível no formulário, então o
        // valor no corpo é o que a pessoa acabou de ver. Diferente de
        // probabilidade/situação, que ficam escondidas atrás do toggle.
        counts_as_conversion: payload.countsAsConversion,
      };
      if (metaOn) {
        body.probability = payload.probability;
        body.stage_type = payload.stageType;
      }
      const res = await fetch(url, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar.");
        return false;
      }
      toast.success(id ? "Etapa atualizada." : "Etapa criada.");
      router.refresh();
      return true;
    } catch {
      toast.error("Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Atalho de um clique para a etapa de conversão. Marcar várias é o caso
  // normal (Compareceu + Cliente + Recorrente), e abrir o formulário de cada
  // uma só para isso seria trabalho repetido. Otimista como `reorder`.
  async function toggleConversion(col: BoardColumn) {
    const next = !col.counts_as_conversion;
    const previous = items;
    setItems(items.map((c) => (c.id === col.id ? { ...c, counts_as_conversion: next } : c)));
    setBusy(true);
    try {
      const res = await fetch(`/api/board-columns/${col.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counts_as_conversion: next }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar.");
        setItems(previous);
        return;
      }
      toast.success(
        next
          ? `"${col.label}" passa a contar como conversão.`
          : `"${col.label}" não conta mais como conversão.`
      );
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar.");
      setItems(previous);
    } finally {
      setBusy(false);
    }
  }

  async function removeStage(col: BoardColumn) {
    if (col.key === "novo") {
      toast.error("A etapa de entrada padrão não pode ser excluída.");
      return;
    }
    if (
      !window.confirm(
        `Excluir a etapa "${col.label}"? Os leads dela voltam para a etapa de entrada.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/board-columns/${col.id}`, { method: "DELETE" });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível excluir.");
        return;
      }
      toast.success("Etapa removida.");
      router.refresh();
    } catch {
      toast.error("Não foi possível excluir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88dvh] max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-4 pr-16 sm:px-6 sm:pr-16">
          <DialogTitle className="text-lg">Configurar funil</DialogTitle>
          <DialogDescription>
            Organize as etapas, cores e regras do processo comercial.
          </DialogDescription>
        </DialogHeader>

        {/* Toggle: exibir probabilidade e situação */}
        <label className="flex min-h-16 shrink-0 cursor-pointer items-center gap-3 border-b border-border/70 bg-muted/20 px-5 py-3 sm:px-6">
          <Checkbox
            checked={metaOn}
            disabled={busy}
            onCheckedChange={(checked) => void toggleMeta(Boolean(checked))}
            aria-label="Mostrar probabilidade e situação"
          />
          <span className="grid gap-0.5 text-sm">
            <span className="font-medium">Mostrar probabilidade e situação</span>
            <span className="text-xs text-muted-foreground">
              Exibe percentual e situação em cada etapa.
            </span>
          </span>
        </label>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <ol className="overflow-hidden rounded-lg border border-border/70 bg-card">
            {items.map((col, index) =>
              editingId === col.id ? (
                <li key={col.id}>
                  <StageForm
                    initialLabel={col.label}
                    initialColor={(col.color as ColorName) ?? "slate"}
                    initialProbability={col.probability}
                    initialStageType={toStageType(col.stage_type)}
                    initialCountsAsConversion={col.counts_as_conversion ?? false}
                    metaOn={metaOn}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={async (payload) => {
                      const ok = await saveStage(col.id, payload);
                      if (ok) setEditingId(null);
                    }}
                  />
                </li>
              ) : (
                <li key={col.id}>
                  <StageRow
                    col={col}
                    index={index}
                    total={items.length}
                    metaOn={metaOn}
                    busy={busy}
                    onUp={() => moveStage(index, -1)}
                    onDown={() => moveStage(index, 1)}
                    onEdit={() => {
                      setAdding(false);
                      setEditingId(col.id);
                    }}
                    onToggleConversion={() => void toggleConversion(col)}
                    onDelete={() => removeStage(col)}
                  />
                </li>
              )
            )}

            {adding ? (
              <li>
                <StageForm
                  initialLabel=""
                  initialColor="slate"
                  initialProbability={null}
                  initialStageType="open"
                  initialCountsAsConversion={false}
                  metaOn={metaOn}
                  busy={busy}
                  onCancel={() => setAdding(false)}
                  onSave={async (payload) => {
                    const ok = await saveStage(null, payload);
                    if (ok) setAdding(false);
                  }}
                />
              </li>
            ) : null}
          </ol>
        </div>

        <DialogFooter className="m-0 shrink-0 flex-row items-center justify-between rounded-none border-t border-border/70 bg-card/95 px-5 py-3 sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            disabled={busy || adding}
          >
            <PlusIcon data-icon="inline-start" />
            Etapa
          </Button>
          <DialogClose render={<Button className="h-11 sm:h-9" />}>Concluir</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StageRow({
  col,
  index,
  total,
  metaOn,
  busy,
  onUp,
  onDown,
  onEdit,
  onToggleConversion,
  onDelete,
}: {
  col: BoardColumn;
  index: number;
  total: number;
  metaOn: boolean;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
  onToggleConversion: () => void;
  onDelete: () => void;
}) {
  const style = getColorStyle((col.color as ColorName) ?? "slate");
  const stageType = toStageType(col.stage_type);
  const stageStyle = getColorStyle(stageTypeColor[stageType]);
  const isEntry = col.key === "novo";
  const isConversion = col.counts_as_conversion ?? false;

  return (
    <div className="flex min-h-14 items-center gap-2 border-b border-border/70 bg-card px-3 py-2 last:border-b-0 sm:px-4">
      <GripVerticalIcon className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
      <span className="w-4 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span className={cn("size-3 shrink-0 rounded-full", style.dot)} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{col.label}</span>

      {/* Sempre visível, mesmo com o toggle de metadados desligado: é a etapa
          que define a taxa de conversão do dashboard. Ícone + texto, nunca
          só cor. */}
      {isConversion ? (
        <Badge
          variant="outline"
          className="shrink-0 gap-1 rounded-full border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
        >
          <TargetIcon className="size-2.5" aria-hidden />
          Conversão
        </Badge>
      ) : null}

      {metaOn ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {col.probability !== null && col.probability !== undefined ? (
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {col.probability}%
            </span>
          ) : null}
          <Badge
            variant="outline"
            className={cn("rounded-full border px-1.5 py-0 text-[10px] font-medium", stageStyle.badge)}
          >
            {stageTypeLabel[stageType]}
          </Badge>
        </span>
      ) : null}

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Mover para cima"
          disabled={busy || index === 0}
          onClick={onUp}
          className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
        >
          <ArrowUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Mover para baixo"
          disabled={busy || index === total - 1}
          onClick={onDown}
          className="size-11 text-muted-foreground hover:text-foreground sm:size-8"
        >
          <ArrowDownIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="size-11 text-muted-foreground sm:size-8" aria-label={`Ações de ${col.label}`} disabled={busy} />}>
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onEdit}><PencilIcon />Editar etapa</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 sm:min-h-8" onClick={onToggleConversion}>
              <TargetIcon />
              {isConversion ? "Não contar conversão" : "Contar como conversão"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 sm:min-h-8" variant="destructive" disabled={isEntry} onClick={onDelete}><Trash2Icon />Excluir etapa</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function StageForm({
  initialLabel,
  initialColor,
  initialProbability,
  initialStageType,
  initialCountsAsConversion,
  metaOn,
  busy,
  onSave,
  onCancel,
}: {
  initialLabel: string;
  initialColor: ColorName;
  initialProbability: number | null;
  initialStageType: StageType;
  initialCountsAsConversion: boolean;
  metaOn: boolean;
  busy: boolean;
  onSave: (payload: StagePayload) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState<ColorName>(initialColor);
  const [probability, setProbability] = useState<string>(
    initialProbability === null || initialProbability === undefined
      ? ""
      : String(initialProbability)
  );
  const [stageType, setStageType] = useState<StageType>(initialStageType);
  const [countsAsConversion, setCountsAsConversion] = useState(initialCountsAsConversion);
  const style = getColorStyle(color);

  function submit() {
    if (!label.trim()) {
      toast.error("Informe o nome da etapa.");
      return;
    }
    const prob = probability.trim() === "" ? null : Number(probability);
    if (prob !== null && (Number.isNaN(prob) || prob < 0 || prob > 100)) {
      toast.error("A probabilidade deve ficar entre 0 e 100.");
      return;
    }
    onSave({ label: label.trim(), color, probability: prob, stageType, countsAsConversion });
  }

  return (
    <div className="grid gap-4 border-b border-border/70 bg-muted/20 p-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className={cn("size-3 shrink-0 rounded-full", style.dot)} aria-hidden />
        <Input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !metaOn) submit();
          }}
          placeholder="Ex.: Em negociação"
          maxLength={40}
          className="h-9"
        />
      </div>

      <ColorSwatchPicker value={color} onChange={setColor} />

      {/* Mesma casca do toggle do topo do diálogo. Fora do bloco `metaOn`
          porque não é metadado opcional: é a definição da métrica. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
        <Checkbox
          checked={countsAsConversion}
          disabled={busy}
          onCheckedChange={(checked) => setCountsAsConversion(Boolean(checked))}
          className="mt-0.5"
          aria-label="Contar como conversão"
        />
        <span className="grid gap-0.5 text-sm">
          <span className="font-medium">Contar como conversão</span>
          <span className="text-xs text-muted-foreground">
            Leads parados nesta etapa entram na taxa de conversão do dashboard. Pode
            marcar mais de uma etapa — só quem está exatamente nelas conta.
          </span>
        </span>
      </label>

      {metaOn ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="stage-prob" className="text-xs">
              Probabilidade (%)
            </Label>
            <Input
              id="stage-prob"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              placeholder="—"
              className="h-9"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="stage-type" className="text-xs">
              Situação
            </Label>
            <FormSelect
              id="stage-type"
              value={stageType}
              onValueChange={(value) => setStageType(value as StageType)}
              className="h-9"
              aria-label="Situação da etapa"
              options={STAGE_TYPES.map((type) => ({ value: type, label: stageTypeLabel[type] }))}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          <XIcon data-icon="inline-start" />
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={busy}>
          {busy ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <CheckIcon data-icon="inline-start" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  );
}
