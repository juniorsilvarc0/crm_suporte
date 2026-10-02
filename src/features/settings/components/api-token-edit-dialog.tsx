"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { accessPresetFields } from "@/features/settings/lib/api-token-access";
import { scopeActionLabel, scopeGroups } from "@/features/settings/lib/api-scope-labels";
import {
  apiTokenEditFormSchema,
  isPastExpiry,
  PAST_EXPIRY_MESSAGE,
  type ApiTokenEditFormInput,
  type ApiTokenEditFormOutput,
} from "@/features/settings/schemas/api-token-actions";
import type { ApiTokenListItem } from "@/features/settings/types";
import { toAppDateKey } from "@/lib/formatters/date";

/** O campo do formulário e o campo que ele vira no PATCH. */
const FORM_TO_BODY = {
  name: "name",
  scopes: "scopes",
  actor_type: "actor_type",
  rate_limit_per_min: "rate_limit_per_min",
  expires_on: "expires_at",
} as const;

type FormField = keyof typeof FORM_TO_BODY;
const FORM_FIELDS = Object.keys(FORM_TO_BODY) as FormField[];

const ACTOR_OPTIONS = [
  { value: "ai", label: "IA (agente de triagem)" },
  { value: "api", label: "Integração" },
];

type PatchResponse = { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> };

/**
 * Edição de um token de API: nome, escopos um a um, tipo, limite por minuto e
 * validade. O segredo não muda (trocar o segredo é gerar outro token), e token
 * revogado não se edita.
 *
 * react-hook-form com o schema do formulário, que usa as mesmas regras de campo
 * da rota. O PATCH leva só o que mudou, e a rota valida de novo.
 */
export function ApiTokenEditDialog({
  token,
  open,
  onOpenChange,
}: {
  token: ApiTokenListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Cada abertura é um formulário novo, com os valores do token daquele momento.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((current) => current + 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {token ? <TokenEditForm key={`${token.id}:${session}`} token={token} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function TokenEditForm({
  token,
  onOpenChange,
}: {
  token: ApiTokenListItem;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
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
  } = useForm<ApiTokenEditFormInput, unknown, ApiTokenEditFormOutput>({
    resolver: zodResolver(apiTokenEditFormSchema),
    defaultValues: {
      name: token.name,
      scopes: token.scopes,
      actor_type: token.actor_type,
      rate_limit_per_min: String(token.rate_limit_per_min),
      expires_on: token.expires_at ? toAppDateKey(token.expires_at) : "",
    },
  });

  const scopes = useWatch({ control, name: "scopes" }) ?? [];
  const actorType = useWatch({ control, name: "actor_type" });
  // Os grupos saem dos escopos ORIGINAIS do token: um `recurso:*` desmarcado
  // continua na lista, para poder ser marcado de novo.
  const groups = scopeGroups(token.scopes);

  function setScopes(next: string[]) {
    setValue("scopes", next, { shouldDirty: true, shouldValidate: true });
  }

  function toggleScope(scope: string, checked: boolean) {
    setScopes(checked ? [...scopes.filter((item) => item !== scope), scope] : scopes.filter((item) => item !== scope));
  }

  function applyAiPreset() {
    const preset = accessPresetFields("ai_triage");
    setScopes(preset.scopes);
    setValue("actor_type", preset.actor_type, { shouldDirty: true });
    setValue("rate_limit_per_min", String(preset.rate_limit_per_min), { shouldDirty: true, shouldValidate: true });
  }

  function handleOpenChange(next: boolean) {
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function onValid(values: ApiTokenEditFormOutput) {
    if (submitting.current) return;
    const outputOf: Record<FormField, unknown> = {
      name: values.name,
      scopes: values.scopes,
      actor_type: values.actor_type,
      rate_limit_per_min: values.rate_limit_per_min,
      expires_on: values.expires_on,
    };
    const body = Object.fromEntries(
      FORM_FIELDS.filter((field) => dirtyFields[field]).map((field) => [FORM_TO_BODY[field], outputOf[field]])
    );
    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }
    if (dirtyFields.expires_on && isPastExpiry(values.expires_on)) {
      setError("expires_on", { type: "validate", message: PAST_EXPIRY_MESSAGE }, { shouldFocus: true });
      return;
    }

    submitting.current = true;
    setPending(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/api-tokens/${token.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as PatchResponse;
      if (!response.ok || !result.ok) {
        let marked = false;
        for (const field of FORM_FIELDS) {
          const message = result.errors?.[FORM_TO_BODY[field]]?.[0];
          if (!message) continue;
          setError(field, { type: "server", message }, { shouldFocus: !marked });
          marked = true;
        }
        if (!marked) setFormError(result.message ?? "Não foi possível alterar o token.");
        return;
      }
      toast.success(result.message ?? "Token alterado.");
      onOpenChange(false);
      router.refresh();
    } catch {
      setFormError("Não foi possível alterar o token.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <ModalShell
      size="medium"
      title="Editar token"
      description={`${token.token_prefix}… O segredo não muda: para trocá-lo, gere outro token e revogue este.`}
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      footer={
        <ModalFooterActions>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending} className="h-11 sm:h-9">
            Cancelar
          </Button>
          <Button type="submit" disabled={pending} className="h-11 sm:h-9">
            {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            Salvar alterações
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
            maxLength={60}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium" id={id("scopes-label")}>
              Escopos
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={applyAiPreset} className="h-11 sm:h-8">
                Aplicar IA de triagem
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setScopes([])} className="h-11 sm:h-8">
                Limpar
              </Button>
            </div>
          </div>
          <FieldDescription className="text-xs">
            {scopes.length === 0
              ? "Sem escopo, o token autentica mas não alcança nada."
              : `${scopes.length} ${scopes.length === 1 ? "escopo marcado" : "escopos marcados"}.`}
          </FieldDescription>
          <div
            role="group"
            aria-labelledby={id("scopes-label")}
            className="grid gap-3 rounded-lg border border-border/70 p-3"
          >
            {groups.map((group) => (
              <fieldset key={group.resource} className="grid gap-1.5">
                <legend className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</legend>
                {group.scopes.map((scope) => (
                  <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-8">
                    <Checkbox
                      checked={scopes.includes(scope)}
                      onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                      aria-label={`${group.label}: ${scopeActionLabel(scope)} (${scope})`}
                    />
                    <span>{scopeActionLabel(scope)}</span>
                    <code className="font-mono text-xs text-muted-foreground">{scope}</code>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <FieldError className="text-xs">{errors.scopes?.message ?? errors.scopes?.[0]?.message}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor={id("actor_type")}>Quem usa</FieldLabel>
          <FormSelect
            id={id("actor_type")}
            value={actorType}
            onValueChange={(value) =>
              setValue("actor_type", value === "ai" ? "ai" : "api", { shouldDirty: true, shouldValidate: true })
            }
            options={ACTOR_OPTIONS}
            aria-describedby={id("actor_type-hint")}
          />
          <FieldDescription id={id("actor_type-hint")} className="text-xs">
            O que o token escreve aparece no CRM como da IA ou da integração.
          </FieldDescription>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={id("rate")}>Limite por minuto</FieldLabel>
            <Input
              id={id("rate")}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={errors.rate_limit_per_min ? true : undefined}
              aria-describedby={errors.rate_limit_per_min ? id("rate-error") : undefined}
              className="h-11 sm:h-10"
              {...register("rate_limit_per_min")}
            />
            <FieldError id={id("rate-error")} className="text-xs">
              {errors.rate_limit_per_min?.message}
            </FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor={id("expires")}>Validade</FieldLabel>
            <Input
              id={id("expires")}
              type="date"
              aria-invalid={errors.expires_on ? true : undefined}
              aria-describedby={errors.expires_on ? id("expires-error") : id("expires-hint")}
              className="h-11 sm:h-10"
              {...register("expires_on")}
            />
            {errors.expires_on ? (
              <FieldError id={id("expires-error")} className="text-xs">
                {errors.expires_on.message}
              </FieldError>
            ) : (
              <FieldDescription id={id("expires-hint")} className="text-xs">
                Vazio: não vence. Com data, vale até o fim desse dia.
              </FieldDescription>
            )}
          </Field>
        </div>
      </FieldGroup>
    </ModalShell>
  );
}
