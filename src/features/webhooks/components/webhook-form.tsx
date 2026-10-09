"use client";

import { useId, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Loader2Icon } from "lucide-react";

import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { WEBHOOK_EVENTS, webhookEventLabel, type WebhookEvent } from "@/features/webhooks/catalog";
import { webhookCreateSchema, type WebhookCreateInput } from "@/features/webhooks/schemas/webhook";
import type { WebhookSubscription } from "@/features/webhooks/types";

const FIELDS = ["name", "url", "events"] as const;
type FormField = (typeof FIELDS)[number];

type SaveResponse = {
  ok?: boolean;
  message?: string;
  errors?: Partial<Record<FormField, string[]>>;
  subscription?: WebhookSubscription;
  secret?: string;
};

/**
 * Cadastrar ou editar um destino. As regras de campo são as da rota (o mesmo
 * schema); a URL ainda passa pela guarda no servidor, e a recusa vem no campo.
 * Na edição, o PATCH leva só o que mudou. Cadastrar devolve o segredo, que
 * quem abriu mostra no lugar deste formulário.
 */
export function WebhookForm({
  subscription,
  onCancel,
  onSaved,
  onPendingChange,
}: {
  /** null = cadastrar. */
  subscription: WebhookSubscription | null;
  onCancel: () => void;
  onSaved: (result: { subscription: WebhookSubscription; secret: string | null }) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, dirtyFields },
  } = useForm<WebhookCreateInput>({
    resolver: zodResolver(webhookCreateSchema),
    defaultValues: {
      name: subscription?.name ?? "",
      url: subscription?.url ?? "",
      events: subscription?.events ?? [],
    },
  });
  const events = useWatch({ control, name: "events" }) ?? [];

  function setEvents(next: WebhookEvent[]) {
    setValue("events", next, { shouldDirty: true, shouldValidate: true });
  }

  function toggleEvent(event: WebhookEvent, checked: boolean) {
    // Na ordem do catálogo, para o PATCH não ver "mudança" só por ordem.
    setEvents(WEBHOOK_EVENTS.filter((item) => (item === event ? checked : events.includes(item))));
  }

  function busy(next: boolean) {
    submitting.current = next;
    setPending(next);
    onPendingChange(next);
  }

  async function onValid(values: WebhookCreateInput) {
    if (submitting.current) return;
    const body = subscription
      ? Object.fromEntries(FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, values[field]]))
      : values;
    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }

    busy(true);
    setFormError(null);
    try {
      const response = await fetch(subscription ? `/api/webhooks/${subscription.id}` : "/api/webhooks", {
        method: subscription ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok || !result.ok || !result.subscription) {
        let marked = false;
        for (const field of FIELDS) {
          const message = result.errors?.[field]?.[0];
          if (!message) continue;
          setError(field, { type: "server", message }, { shouldFocus: !marked });
          marked = true;
        }
        if (!marked) setFormError(result.message ?? "Não foi possível salvar o destino.");
        return;
      }
      onSaved({ subscription: result.subscription, secret: result.secret ?? null });
    } catch {
      setFormError("Não foi possível salvar o destino.");
    } finally {
      busy(false);
    }
  }

  return (
    <ModalShell
      size="medium"
      title={subscription ? "Editar destino" : "Novo destino"}
      description={
        subscription
          ? "O segredo não muda aqui: para trocá-lo, use Trocar segredo."
          : "O CRM envia os eventos escolhidos a esta URL, assinados com um segredo que ele mesmo gera."
      }
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      footer={
        <ModalFooterActions>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending} className="h-11 sm:h-9">
            Cancelar
          </Button>
          <Button type="submit" disabled={pending} className="h-11 sm:h-9">
            {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            {subscription ? "Salvar alterações" : "Cadastrar destino"}
          </Button>
        </ModalFooterActions>
      }
    >
      <FieldGroup aria-busy={pending}>
        {formError ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <Field>
          <FieldLabel htmlFor={id("name")}>Nome</FieldLabel>
          <Input
            id={id("name")}
            autoComplete="off"
            maxLength={80}
            placeholder="Ex.: ERP"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? id("name-error") : undefined}
            className="h-11 sm:h-10"
            {...register("name")}
          />
          <FieldError id={id("name-error")} className="text-xs">
            {errors.name?.message}
          </FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor={id("url")}>URL</FieldLabel>
          <Input
            id={id("url")}
            // Texto com teclado de URL: a regra fica com o schema e a guarda do
            // servidor, sem o balão nativo do navegador no meio.
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={2000}
            placeholder="https://"
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={errors.url ? id("url-error") : id("url-hint")}
            className="h-11 font-mono text-sm sm:h-10"
            {...register("url")}
          />
          {errors.url ? (
            <FieldError id={id("url-error")} className="text-xs">
              {errors.url.message}
            </FieldError>
          ) : (
            <FieldDescription id={id("url-hint")} className="text-xs">
              Em produção, só HTTPS e nunca um endereço de rede interna. Redirecionamento não é seguido.
            </FieldDescription>
          )}
        </Field>

        <Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium" id={id("events-label")}>
              Eventos
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEvents([...WEBHOOK_EVENTS])} className="h-11 sm:h-8">
                Marcar todos
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEvents([])} className="h-11 sm:h-8">
                Limpar
              </Button>
            </div>
          </div>
          <div role="group" aria-labelledby={id("events-label")} className="grid gap-1 rounded-lg border border-border/70 p-3">
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-sm sm:min-h-8">
                <Checkbox
                  checked={events.includes(event)}
                  onCheckedChange={(checked) => toggleEvent(event, checked === true)}
                  aria-label={`${webhookEventLabel[event]} (${event})`}
                />
                {/* O nome acessível é o aria-label: o texto visível não se repete no leitor de tela. */}
                <span className="min-w-0" aria-hidden>
                  {webhookEventLabel[event]}
                </span>
                <code className="ml-auto hidden font-mono text-xs text-muted-foreground sm:inline" aria-hidden>
                  {event}
                </code>
              </label>
            ))}
          </div>
          <FieldError className="text-xs">{errors.events?.message ?? errors.events?.root?.message}</FieldError>
        </Field>
      </FieldGroup>
    </ModalShell>
  );
}
