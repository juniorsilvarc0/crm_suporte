"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Loader2Icon, RotateCwIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isColorName } from "@/features/tags/schemas/colors";
import { TicketStatusBadge } from "@/features/tickets/components/ticket-status-badge";
import { TICKET_STATUS_FALLBACK_COLOR } from "@/features/tickets/lib/ticket-status";
import { ticketRequest } from "@/features/tickets/lib/ticket-request";
import {
  ticketStatusPatchSchema,
  type TicketStatusPatchInput,
  type TicketStatusPatchValues,
} from "@/features/tickets/schemas/catalog";
import type {
  SlaMode,
  TicketCatalogErrorBody,
  TicketStatusOption,
} from "@/features/tickets/types";
import { cn } from "@/lib/utils";

const FAILURE_MESSAGE = "Não foi possível salvar o status.";
const NETWORK_MESSAGE = "Não foi possível salvar o status. Confira a conexão e tente de novo.";

// Os campos do PATCH: erro da rota num deles vai para o campo.
const STATUS_FIELDS = ["label", "color"] as const;

// ticket_statuses.sla_mode, só leitura: é da migration (os CHECKs de tickets
// dependem dele).
const SLA_MODE_LABEL: Record<SlaMode, string> = {
  running: "Correndo",
  paused: "Pausado",
  stopped: "Parado",
};

/**
 * Status do ticket (4f, admin): rótulo e cor de cada um dos 8, com a prévia do
 * selo ao vivo. O que se grava aqui aparece em todos os selos pelo catálogo.
 * Relógio do SLA e "encerra o ticket" são da migration e só aparecem.
 *
 * Uma linha por status, na ordem de `position`, e cada uma salva sozinha
 * (PATCH /api/ticket-statuses/[key]) só com o que mudou. `statuses` nulo = a
 * leitura falhou: a tela diz que falhou, nunca "nenhum status".
 */
export function TicketStatusesManager({ statuses }: { statuses: TicketStatusOption[] | null }) {
  const router = useRouter();
  const titleId = useId();
  const [refreshing, startRefresh] = useTransition();

  let content: ReactNode;
  if (statuses === null) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>Não foi possível carregar os status.</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={refreshing}
            className="h-11 sm:h-9"
          >
            <RotateCwIcon data-icon="inline-start" className={cn(refreshing && "animate-spin")} />
            Tentar de novo
          </Button>
        </span>
      </EmptyState>
    );
  } else if (statuses.length === 0) {
    content = <EmptyState>Nenhum status cadastrado.</EmptyState>;
  } else {
    const rows = [...statuses].sort((a, b) => a.position - b.position);
    content = (
      <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        {rows.map((status) => (
          <TicketStatusRow key={status.key} status={status} />
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <div>
        <h2 id={titleId} className="text-sm font-semibold">
          Status do ticket
        </h2>
        <p className="text-sm text-muted-foreground">
          Rótulo e cor aparecem em todos os selos. O relógio do SLA e o encerramento são fixos.
        </p>
      </div>
      {content}
    </section>
  );
}

/**
 * Um status. react-hook-form + zod com o schema da rota
 * (`ticketStatusPatchSchema`); o corpo leva só os `dirtyFields`. Rótulo
 * repetido volta 409 `duplicate` com o status que já o usa, citado no campo.
 */
function TicketStatusRow({ status }: { status: TicketStatusOption }) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);
  // 409: o status que já tem o rótulo (ausente quando a releitura dele falhou).
  const [conflict, setConflict] = useState<TicketStatusOption | null>(null);
  // Depois de salvar, o "Salvar" trava até a página relida chegar. Os campos
  // seguem editáveis: desligá-los tiraria o foco de quem salvou pelo Enter.
  const [refreshing, startRefresh] = useTransition();

  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<TicketStatusPatchValues, unknown, TicketStatusPatchInput>({
    resolver: zodResolver(ticketStatusPatchSchema),
    // `values`, não `defaultValues`: o que o servidor devolve (este admin
    // salvou, ou outra aba) entra na linha sem remontá-la, e o foco fica onde
    // estava. O campo que está sendo editado guarda o que foi digitado.
    values: {
      label: status.label,
      // Cor fora da paleta (o banco só confere o formato) abre como a de
      // recurso, a que o selo já mostra, e só é gravada se a pessoa escolher
      // outra: salvar só o rótulo não esbarra no "Cor inválida.".
      color: isColorName(status.color) ? status.color : TICKET_STATUS_FALLBACK_COLOR[status.key],
    },
    resetOptions: { keepDirtyValues: true },
  });

  // A prévia lê o que está sendo digitado, não o gravado.
  const label = useWatch({ control, name: "label" });
  const color = useWatch({ control, name: "color" });

  async function onValid(values: TicketStatusPatchInput) {
    if (submitting.current) return;
    const body = Object.fromEntries(
      STATUS_FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, values[field]])
    );
    if (Object.keys(body).length === 0) return;

    submitting.current = true;
    setPending(true);
    setConflict(null);
    const result = await ticketRequest<{ ok: true; item: TicketStatusOption }>(
      `/api/ticket-statuses/${status.key}`,
      { method: "PATCH", body }
    );
    submitting.current = false;
    setPending(false);

    if (result.ok) {
      // O gravado vira a nova base. Sem `keepDirtyValues` aqui: com ele, os
      // campos que acabaram de ir seguiriam marcados e iriam de novo no próximo
      // envio.
      reset({ label: values.label, color: values.color }, { keepDirtyValues: false });
      toast.success(`Status «${values.label ?? status.label}» salvo.`);
      startRefresh(() => router.refresh());
      return;
    }
    if (result.status === 0) {
      setError("root.server", { type: "network", message: NETWORK_MESSAGE });
      return;
    }

    // As rotas de catálogo marcam campos que não são do ticket (`label`) e
    // trazem o `item` do 409.
    const error = result.body as TicketCatalogErrorBody<TicketStatusOption> | null;
    const duplicate = error?.code === "duplicate";
    let marked = false;
    for (const field of STATUS_FIELDS) {
      const message = error?.errors?.[field]?.[0];
      if (!message) continue;
      setError(
        field,
        { type: duplicate && field === "label" ? "duplicate" : "server", message },
        { shouldFocus: !marked }
      );
      marked = true;
    }
    if (duplicate && error?.item) setConflict(error.item);
    // Erro sem campo (sessão, status inexistente, falha do banco) vira alerta
    // na linha, não toast que some (UI.md §5.23).
    if (!marked) {
      setError("root.server", { type: "server", message: error?.message ?? FAILURE_MESSAGE });
    }
  }

  const labelInvalid = Boolean(errors.label);
  // O status que já usa o rótulo só enquanto o erro no campo é o do 409.
  const conflictItem = errors.label?.type === "duplicate" ? conflict : null;

  return (
    <form
      noValidate
      aria-label={`Status ${status.label}`}
      aria-busy={pending || refreshing || undefined}
      // Dentro do handler, não no render: `handleSubmit(onValid)` no render
      // entrega ao React Compiler uma função que lê a trava (ref) de envio.
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      // ⚠️ `grid-cols-[minmax(0,1fr)]` NÃO é enfeite: sem trilha declarada, o
      // rótulo longo na prévia alarga o formulário no celular e a lista corta o
      // campo e o "Salvar" (UI.md §9).
      className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span id={id("preview")} className="text-xs text-muted-foreground">
            Prévia
          </span>
          <div aria-labelledby={id("preview")} role="group" className="min-w-0">
            <TicketStatusBadge status={{ key: status.key, label, color }} />
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex gap-1">
            <dt>Relógio do SLA:</dt>
            <dd className="font-medium text-foreground">{SLA_MODE_LABEL[status.sla_mode]}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Encerra o ticket:</dt>
            <dd className="font-medium text-foreground">{status.is_terminal ? "Sim" : "Não"}</dd>
          </div>
        </dl>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] md:items-start">
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor={id("label")}>Rótulo</Label>
          <Input
            id={id("label")}
            autoComplete="off"
            maxLength={40}
            aria-invalid={labelInvalid || undefined}
            aria-describedby={labelInvalid ? id("label-error") : undefined}
            className="h-11 sm:h-9"
            {...register("label")}
          />
          <FieldError id={id("label-error")} className="text-xs">
            {errors.label?.message ? (
              <>
                {errors.label.message}
                {conflictItem ? (
                  <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
                    Em uso por
                    <span className="min-w-0">
                      <TicketStatusBadge status={conflictItem} />
                    </span>
                  </span>
                ) : null}
              </>
            ) : null}
          </FieldError>
        </div>

        <Controller
          control={control}
          name="color"
          render={({ field, fieldState }) => (
            <div className="grid min-w-0 content-start gap-2">
              {/* O grupo de cores já se chama "Cor" (aria-label do picker). */}
              <span aria-hidden className="text-sm leading-none font-medium">
                Cor
              </span>
              <ColorSwatchPicker
                // O `values` já troca a cor fora da paleta pela de recurso; aqui
                // é só o estreitamento do tipo para o picker.
                value={
                  field.value && isColorName(field.value)
                    ? field.value
                    : TICKET_STATUS_FALLBACK_COLOR[status.key]
                }
                onChange={field.onChange}
              />
              <FieldError className="text-xs">{fieldState.error?.message}</FieldError>
            </div>
          )}
        />

        <div className="flex justify-end md:pt-6">
          <Button
            type="submit"
            disabled={pending || refreshing || !isDirty}
            className="h-11 sm:h-9"
          >
            {pending || refreshing ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            Salvar
          </Button>
        </div>
      </div>

      {errors.root?.server?.message ? (
        <Alert variant="destructive">{errors.root.server.message}</Alert>
      ) : null}
    </form>
  );
}
