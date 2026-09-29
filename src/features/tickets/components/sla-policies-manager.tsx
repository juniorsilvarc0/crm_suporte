"use client";

import { useId, useRef, useState, useTransition, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { InfoIcon, Loader2Icon, RotateCwIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TicketPriorityBadge } from "@/features/tickets/components/ticket-priority-badge";
import { TICKET_PRIORITY_LABEL } from "@/features/tickets/lib/ticket-priority";
import { ticketRequest } from "@/features/tickets/lib/ticket-request";
import {
  slaPolicyPatchSchema,
  type SlaPolicyPatchInput,
  type SlaPolicyPatchValues,
} from "@/features/tickets/schemas/catalog";
import type { TicketCatalogErrorBody, TicketSlaPolicy } from "@/features/tickets/types";
import { cn } from "@/lib/utils";

const FAILURE_MESSAGE = "Não foi possível salvar o SLA.";
const NETWORK_MESSAGE = "Não foi possível salvar o SLA. Confira a conexão e tente de novo.";

// Os campos do PATCH, na ordem da tela: erro da rota num deles vai para o campo.
const SLA_FIELDS = ["first_response_minutes", "resolution_minutes", "warn_pct"] as const;

/** O prazo como a tela o edita: horas e minutos, em texto (o campo pode estar vazio). */
export type DurationText = { hours: string; minutes: string };

const DIGITS_RE = /^\d+$/;

/** Minutos gravados → horas e minutos da tela ("90" vira 1 h 30 min). */
export function splitMinutes(total: number | undefined): DurationText {
  if (total === undefined || !Number.isSafeInteger(total) || total < 0) {
    return { hours: "", minutes: "" };
  }
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
}

/**
 * Horas e minutos da tela → minutos, que é o que a rota grava. Parte vazia
 * conta zero ("2 h" sem minutos). Qualquer outra coisa que não sejam dígitos dá
 * `NaN`, e o zod do formulário a recusa: a conversão não adivinha "1,5 h".
 */
export function durationToMinutes({ hours, minutes }: DurationText): number {
  const h = hours.trim();
  const m = minutes.trim();
  if ((h && !DIGITS_RE.test(h)) || (m && !DIGITS_RE.test(m))) return Number.NaN;
  return Number(h || 0) * 60 + Number(m || 0);
}

/**
 * Prazos de SLA por prioridade (4f, admin): 1ª resposta e solução em h:min e o
 * aviso em %. Uma linha por prioridade, na ordem do `rank`, e cada uma salva
 * sozinha (PATCH /api/sla-policies/[priority]) só com o que mudou.
 *
 * Vale para os tickets abertos daqui em diante e para os que mudarem de
 * prioridade: o ticket guarda o snapshot do SLA na abertura e tira outro a cada
 * troca de prioridade (`ticket_update`), e o aviso do topo diz isso. `policies`
 * nulo = a leitura falhou: a tela diz que falhou, nunca "nenhuma prioridade".
 */
export function SlaPoliciesManager({ policies }: { policies: TicketSlaPolicy[] | null }) {
  const router = useRouter();
  const titleId = useId();
  const [refreshing, startRefresh] = useTransition();

  let content: ReactNode;
  if (policies === null) {
    content = (
      <EmptyState>
        <span className="flex flex-col items-center gap-3">
          <span>Não foi possível carregar os prazos de SLA.</span>
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
  } else if (policies.length === 0) {
    content = <EmptyState>Nenhuma prioridade cadastrada.</EmptyState>;
  } else {
    const rows = [...policies].sort((a, b) => a.rank - b.rank);
    content = (
      <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        {rows.map((policy) => (
          <SlaPolicyRow key={policy.priority} policy={policy} />
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <div>
        <h2 id={titleId} className="text-sm font-semibold">
          Prazos de SLA
        </h2>
        <p className="text-sm text-muted-foreground">
          Tempo corrido, 24 h por dia, até a 1ª resposta e até a solução.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Vale para tickets abertos daqui em diante e para os que mudarem de prioridade. Os demais
          mantêm o prazo que já têm.
        </p>
      </div>

      {content}
    </section>
  );
}

/**
 * Uma prioridade. react-hook-form + zod com o schema da rota
 * (`slaPolicyPatchSchema`): o formulário tem sempre os três campos, então a
 * ordem (1ª resposta ≤ solução) é conferida aqui antes de enviar, mesmo quando
 * só um deles mudou. O corpo leva só os `dirtyFields`.
 */
function SlaPolicyRow({ policy }: { policy: TicketSlaPolicy }) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const label = TICKET_PRIORITY_LABEL[policy.priority];
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);
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
  } = useForm<SlaPolicyPatchValues, unknown, SlaPolicyPatchInput>({
    resolver: zodResolver(slaPolicyPatchSchema),
    // `values`, não `defaultValues`: o que o servidor devolve (este admin
    // salvou, ou outra aba) entra na linha sem remontá-la, e o foco fica onde
    // estava. O campo que está sendo editado guarda o que foi digitado.
    values: {
      first_response_minutes: policy.first_response_minutes,
      resolution_minutes: policy.resolution_minutes,
      warn_pct: policy.warn_pct,
    },
    resetOptions: { keepDirtyValues: true },
  });

  async function onValid(values: SlaPolicyPatchInput) {
    if (submitting.current) return;
    const body = Object.fromEntries(
      SLA_FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, values[field]])
    );
    if (Object.keys(body).length === 0) return;

    submitting.current = true;
    setPending(true);
    const result = await ticketRequest<{ ok: true; item: TicketSlaPolicy }>(
      `/api/sla-policies/${policy.priority}`,
      { method: "PATCH", body }
    );
    submitting.current = false;
    setPending(false);

    if (result.ok) {
      // O gravado vira a nova base. Sem `keepDirtyValues` aqui: com ele, os
      // campos que acabaram de ir seguiriam marcados e iriam de novo no próximo
      // envio.
      reset(values, { keepDirtyValues: false });
      toast.success(`SLA da prioridade ${label} salvo.`);
      startRefresh(() => router.refresh());
      return;
    }
    if (result.status === 0) {
      setError("root.server", { type: "network", message: NETWORK_MESSAGE });
      return;
    }

    // As rotas de catálogo marcam campos que não são do ticket (`warn_pct`…).
    const error = result.body as TicketCatalogErrorBody<TicketSlaPolicy> | null;
    let marked = false;
    for (const field of SLA_FIELDS) {
      const message = error?.errors?.[field]?.[0];
      if (!message) continue;
      setError(field, { type: "server", message }, { shouldFocus: !marked });
      marked = true;
    }
    // Erro sem campo (sessão, prioridade inexistente, falha do banco) vira
    // alerta na linha, não toast que some (UI.md §5.23).
    if (!marked) {
      setError("root.server", { type: "server", message: error?.message ?? FAILURE_MESSAGE });
    }
  }

  const warnInvalid = Boolean(errors.warn_pct);

  return (
    <form
      noValidate
      aria-labelledby={id("title")}
      aria-busy={pending || refreshing || undefined}
      // Dentro do handler, não no render: `handleSubmit(onValid)` no render
      // entrega ao React Compiler uma função que lê a trava (ref) de envio.
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      className="grid gap-3 p-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <h3 id={id("title")} className="flex min-w-0 lg:w-24 lg:shrink-0 lg:pt-7">
          <TicketPriorityBadge priority={policy.priority} />
        </h3>

        <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,10rem)]">
          <Controller
            control={control}
            name="first_response_minutes"
            render={({ field, fieldState }) => (
              <DurationField
                legend="1ª resposta"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                error={fieldState.error?.message}
                errorId={id("first-error")}
              />
            )}
          />
          <Controller
            control={control}
            name="resolution_minutes"
            // O erro de ordem mora na 1ª resposta: depois do 1º envio, corrigir a
            // solução revalida a 1ª resposta também.
            rules={{ deps: "first_response_minutes" }}
            render={({ field, fieldState }) => (
              <DurationField
                legend="Solução"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                error={fieldState.error?.message}
                errorId={id("resolution-error")}
              />
            )}
          />

          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id("warn")}>Aviso em</Label>
            <div className="flex items-center gap-2">
              <Input
                id={id("warn")}
                inputMode="numeric"
                autoComplete="off"
                maxLength={2}
                aria-invalid={warnInvalid || undefined}
                aria-describedby={warnInvalid ? id("warn-error") : undefined}
                className="h-11 w-16 tabular-nums sm:h-9"
                {...register("warn_pct", { valueAsNumber: true })}
              />
              <span className="text-sm text-muted-foreground">% do prazo</span>
            </div>
            <FieldError id={id("warn-error")} className="text-xs">
              {errors.warn_pct?.message}
            </FieldError>
          </div>
        </div>

        <div className="flex justify-end lg:pt-6">
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

/**
 * Prazo em horas + minutos que grava minutos. O texto dos dois campos é estado
 * local (o campo pode ficar vazio enquanto se digita); o formulário recebe o
 * total a cada tecla. Ao sair de um campo, o texto se normaliza ("0 h 90 min"
 * vira "1 h 30 min"). Valor que chega de fora (o `reset` depois de salvar, ou o
 * servidor pelo `values`) refaz o texto.
 */
function DurationField({
  legend,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  errorId,
}: {
  legend: string;
  value: number | undefined;
  onChange: (minutes: number) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLInputElement>;
  error: string | undefined;
  errorId: string;
}) {
  const [text, setText] = useState(() => splitMinutes(value));
  // O último total que este campo mandou: diferente do `value` = mudou por fora.
  const [emitted, setEmitted] = useState(value);
  if (!Object.is(value, emitted)) {
    setEmitted(value);
    setText(splitMinutes(value));
  }

  function change(part: keyof DurationText, raw: string) {
    const next = { ...text, [part]: raw };
    const total = durationToMinutes(next);
    setText(next);
    setEmitted(total);
    onChange(total);
  }

  function normalize() {
    const total = durationToMinutes(text);
    if (Number.isFinite(total)) setText(splitMinutes(total));
    onBlur();
  }

  const invalid = Boolean(error);
  const inputProps = {
    inputMode: "numeric" as const,
    autoComplete: "off",
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId : undefined,
    onBlur: normalize,
  };

  return (
    <FieldSet className="min-w-0 gap-2">
      <FieldLegend variant="label" className="mb-0">
        {legend}
      </FieldLegend>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          aria-label="Horas"
          maxLength={4}
          value={text.hours}
          onChange={(event) => change("hours", event.target.value)}
          className="h-11 w-20 tabular-nums sm:h-9"
          {...inputProps}
        />
        <span aria-hidden className="text-sm text-muted-foreground">
          h
        </span>
        <Input
          aria-label="Minutos"
          maxLength={3}
          value={text.minutes}
          onChange={(event) => change("minutes", event.target.value)}
          className="h-11 w-16 tabular-nums sm:h-9"
          {...inputProps}
        />
        <span aria-hidden className="text-sm text-muted-foreground">
          min
        </span>
      </div>
      <FieldError id={errorId} className="text-xs">
        {error}
      </FieldError>
    </FieldSet>
  );
}
