"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { DataToolbar, ToolbarSearch } from "@/components/data-display/data-toolbar";
import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ENVIRONMENT_VARIABLE_NAME_PATTERN,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TRANSCRIPTION_MODEL_NAME,
  type EnvironmentVariableListItem,
  type TranscriptionModelConfig,
} from "@/features/settings/types";
import { formatDateTime } from "@/lib/formatters/date";

type EditorState = {
  mode: "create" | "replace";
};

type ApiResult = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
};

const sourceLabel = {
  vault: "Cofre",
  environment: "Servidor",
} as const;

export function EnvironmentVariablesManager({
  variables,
  transcriptionModel,
}: {
  variables: EnvironmentVariableListItem[];
  transcriptionModel: TranscriptionModelConfig;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] =
    useState<EnvironmentVariableListItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const [model, setModel] = useState(transcriptionModel.value);
  const [syncedModel, setSyncedModel] = useState(transcriptionModel.value);
  const [savingModel, setSavingModel] = useState(false);

  if (transcriptionModel.value !== syncedModel) {
    setSyncedModel(transcriptionModel.value);
    setModel(transcriptionModel.value);
  }

  const filteredVariables = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return variables;
    return variables.filter((variable) =>
      variable.name.toLocaleLowerCase("pt-BR").includes(normalized)
    );
  }, [query, variables]);

  function openCreate() {
    setEditor({ mode: "create" });
    setName("");
    setValue("");
    setShowValue(false);
    setErrors({});
  }

  function openReplace(variable: EnvironmentVariableListItem) {
    setEditor({ mode: "replace" });
    setName(variable.name);
    setValue("");
    setShowValue(false);
    setErrors({});
  }

  function closeEditor() {
    setEditor(null);
    setName("");
    setValue("");
    setShowValue(false);
    setErrors({});
  }

  async function saveVariable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim().toUpperCase();

    if (normalizedName === OPENAI_TRANSCRIPTION_MODEL_NAME) {
      setErrors({ name: ["Use o seletor de modelo abaixo."] });
      return;
    }
    if (!ENVIRONMENT_VARIABLE_NAME_PATTERN.test(normalizedName)) {
      setErrors({
        name: ["Use letras maiúsculas, números e sublinhado. Comece por uma letra."],
      });
      return;
    }
    if (!value) {
      setErrors({ value: ["Informe o valor da variável."] });
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      const response = await fetch("/api/settings/environment-variables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          value,
          replace: editor?.mode === "replace",
        }),
      });
      const result = (await response.json().catch(() => ({}))) as ApiResult;

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar a variável.");
        return;
      }

      toast.success(result.message ?? "Variável salva.");
      closeEditor();
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar a variável.");
    } finally {
      setSaving(false);
    }
  }

  async function removeVariable() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const response = await fetch("/api/settings/environment-variables", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: removeTarget.name }),
      });
      const result = (await response.json().catch(() => ({}))) as ApiResult;

      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível remover a variável.");
        return;
      }

      toast.success(result.message ?? "Variável removida.");
      setRemoveTarget(null);
      router.refresh();
    } catch {
      toast.error("Não foi possível remover a variável.");
    } finally {
      setRemoving(false);
    }
  }

  async function saveTranscriptionModel() {
    setSavingModel(true);
    try {
      const response = await fetch("/api/settings/environment-variables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: OPENAI_TRANSCRIPTION_MODEL_NAME,
          value: model,
          replace: true,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as ApiResult;

      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar o modelo.");
        return;
      }

      toast.success("Modelo de transcrição salvo.");
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar o modelo.");
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <>
      <section className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Variáveis do CRM</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Chaves livres para integrações compatíveis do servidor. Valores salvos
              não voltam a ser exibidos.
            </p>
          </div>
          <Button onClick={openCreate} className="h-11 sm:h-9">
            <PlusIcon data-icon="inline-start" />
            Adicionar variável
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>
            Valores gerenciados ficam cifrados no cofre. Eles sobrescrevem a
            configuração equivalente da VPS sem revelar o conteúdo na interface.
            Variáveis públicas continuam exigindo rebuild.
          </p>
        </div>

        <DataToolbar>
          <ToolbarSearch
            aria-label="Buscar variável"
            placeholder="Buscar variável por nome..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </DataToolbar>

        {filteredVariables.length === 0 ? (
          <EmptyState>
            {variables.length === 0
              ? "Nenhuma variável cadastrada."
              : "Nenhuma variável encontrada."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-muted/20 px-2 pb-2 shadow-soft md:block">
              <Table variant="cards">
                <TableHeader>
                  <TableRow variant="cards-header">
                    <TableHead className="text-xs uppercase tracking-normal text-muted-foreground">
                      Variável
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-normal text-muted-foreground">
                      Origem
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-normal text-muted-foreground">
                      Atualizada
                    </TableHead>
                    <TableHead className="w-48" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVariables.map((variable) => (
                    <TableRow key={variable.name} variant="card">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <KeyRoundIcon className="size-4 text-muted-foreground" />
                          <code className="font-mono text-xs font-medium">
                            {variable.name}
                          </code>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Valor protegido
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{sourceLabel[variable.source]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {variable.updatedAt ? formatDateTime(variable.updatedAt) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openReplace(variable)}
                          >
                            <PencilIcon data-icon="inline-start" />
                            {variable.source === "environment" ? "Sobrescrever" : "Substituir"}
                          </Button>
                          {variable.source === "vault" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setRemoveTarget(variable)}
                            >
                              <Trash2Icon data-icon="inline-start" />
                              Remover
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft md:hidden">
              {filteredVariables.map((variable) => (
                <article key={variable.name} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2">
                        <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
                        <code className="truncate font-mono text-xs font-medium">
                          {variable.name}
                        </code>
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {variable.updatedAt
                          ? `Atualizada em ${formatDateTime(variable.updatedAt)}`
                          : "Configurada no servidor"}
                      </p>
                    </div>
                    <Badge variant="outline">{sourceLabel[variable.source]}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11"
                      onClick={() => openReplace(variable)}
                    >
                      <PencilIcon data-icon="inline-start" />
                      {variable.source === "environment" ? "Sobrescrever" : "Substituir"}
                    </Button>
                    {variable.source === "vault" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 text-destructive hover:text-destructive"
                        onClick={() => setRemoveTarget(variable)}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Remover
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-7 grid gap-3 border-t border-border/70 pt-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Transcrição de áudios</h2>
            <Badge variant="outline">
              {transcriptionModel.source === "vault"
                ? "Cofre"
                : transcriptionModel.source === "environment"
                  ? "Servidor"
                  : "Padrão"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Modelo usado ao transcrever áudios do WhatsApp.
          </p>
        </div>
        <div className="flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Label htmlFor="openai-transcription-model">Modelo OpenAI</Label>
            <FormSelect
              id="openai-transcription-model"
              value={model}
              onValueChange={(next) => setModel(next as typeof model)}
              options={OPENAI_TRANSCRIPTION_MODELS}
              aria-label="Modelo OpenAI para transcrição"
            />
          </div>
          <Button
            type="button"
            onClick={saveTranscriptionModel}
            disabled={savingModel || model === transcriptionModel.value}
            className="h-11 sm:h-10 sm:w-28"
          >
            {savingModel ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            Salvar
          </Button>
        </div>
      </section>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && closeEditor()}>
        <ModalShell
          size="compact"
          title={editor?.mode === "replace" ? "Substituir variável" : "Adicionar variável"}
          description="O valor será cifrado e não poderá ser consultado depois."
          onSubmit={saveVariable}
          footer={
            <ModalFooterActions>
              <Button type="button" variant="outline" onClick={closeEditor} className="h-11 sm:h-9">
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="h-11 sm:h-9">
                {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Salvar variável
              </Button>
            </ModalFooterActions>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="environment-variable-name">Chave</Label>
              <Input
                id="environment-variable-name"
                value={name}
                onChange={(event) => setName(event.target.value.toUpperCase())}
                disabled={editor?.mode === "replace"}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="OPENAI_API_KEY"
                maxLength={64}
                required
                className="h-11 font-mono sm:h-10"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "environment-variable-name-error" : undefined}
              />
              {errors.name ? (
                <p id="environment-variable-name-error" className="text-xs text-destructive">
                  {errors.name[0]}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Letras, números e sublinhado. Ex.: OPENAI_API_KEY.
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="environment-variable-value">Novo valor</Label>
              <div className="relative">
                <Input
                  id="environment-variable-value"
                  type={showValue ? "text" : "password"}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={16_384}
                  required
                  className="h-11 pr-12 font-mono sm:h-10"
                  aria-invalid={errors.value ? true : undefined}
                  aria-describedby={errors.value ? "environment-variable-value-error" : undefined}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 size-11 sm:size-10"
                  onClick={() => setShowValue((current) => !current)}
                  aria-label={showValue ? "Ocultar valor" : "Mostrar valor"}
                >
                  {showValue ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              </div>
              {errors.value ? (
                <p id="environment-variable-value-error" className="text-xs text-destructive">
                  {errors.value[0]}
                </p>
              ) : null}
            </div>
          </div>
        </ModalShell>
      </Dialog>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <ModalShell
          size="compact"
          title="Remover variável"
          description={
            removeTarget
              ? `A substituição segura de ${removeTarget.name} será removida.`
              : undefined
          }
          footer={
            <ModalFooterActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRemoveTarget(null)}
                className="h-11 sm:h-9"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={removing}
                onClick={removeVariable}
                className="h-11 sm:h-9"
              >
                {removing ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Trash2Icon data-icon="inline-start" />
                )}
                Remover
              </Button>
            </ModalFooterActions>
          }
        >
          <p className="text-sm text-muted-foreground">
            Se a mesma chave existir no ambiente da VPS, o valor do servidor
            voltará a ser usado automaticamente.
          </p>
        </ModalShell>
      </Dialog>
    </>
  );
}
