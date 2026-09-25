"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardCheckIcon,
  GitBranchIcon,
  Loader2Icon,
  NotebookPenIcon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  leadSourceLabel,
  leadStatusLabel,
  leadStatusOrder,
  tipoServicoOptions,
} from "@/features/leads/schemas/status";
import type { Lead } from "@/features/leads/types";
import type { LeadSource } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export type EditableLead = Pick<
  Lead,
  | "id"
  | "name"
  | "phone"
  | "instagram_user"
  | "email"
  | "status"
  | "source"
  | "tipo_ensaio"
  | "valor_estimado"
  | "is_recorrente"
  | "interesse"
  | "notes"
>;

export type LeadEditResult = {
  notes: string | null;
};

const sourceOptions: LeadSource[] = [
  "whatsapp",
  "particular",
  "agencia",
  "anuncio",
  "indicacao",
  "importado",
  "outro",
];

function boolSelectValue(value: boolean | null) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

/**
 * Formulário compartilhado por Leads, Funil e Agenda.
 *
 * É painel, não diálogo. Assim, qualquer superfície que já esteja aberta troca
 * o próprio conteúdo sem empilhar backdrop, foco ou gesto de fechar (UI.md §9).
 */
export function LeadEditPanel({
  lead,
  onSaved,
  onCancel,
  cancelLabel = "Cancelar",
}: {
  lead: EditableLead;
  onSaved: (result: LeadEditResult) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setErrors({});

    const payload = Object.fromEntries(new FormData(event.currentTarget));
    // Não reenvia identidade nem etapa sem mudança. Além de evitar trabalho no
    // banco, isto impede uma edição apenas de nome de esbarrar no conflito de
    // múltiplas oportunidades que só importa quando a etapa realmente muda.
    if (payload.phone === (lead.phone ?? "")) delete payload.phone;
    if (payload.status === lead.status) delete payload.status;

    // Telefone existente apagado continua indo ao servidor e sendo recusado:
    // remover uma identidade não pode acontecer silenciosamente.

    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        errors?: Record<string, string[]>;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar.");
        return;
      }

      toast.success("Lead atualizado.");
      router.refresh();
      onSaved({
        notes:
          typeof payload.notes === "string"
            ? payload.notes.trim() || null
            : lead.notes,
      });
    } catch {
      toast.error("Não foi possível salvar.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const id = (field: string) => `${fieldId}-${field}`;

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [-webkit-overflow-scrolling:touch] sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto w-full max-w-5xl">
          <div className="border-b border-border/70 pb-5">
            <p className="text-xs font-medium text-primary">Cadastro do lead</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              Informações principais
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              As alterações serão refletidas na agenda, no funil e no atendimento.
            </p>
          </div>

          <EditGroup
            icon={<UserRoundIcon />}
            title="Contato"
            description="Identificação e canais para falar com o lead."
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <EditField htmlFor={id("name")} label="Nome" error={errors.name?.[0]}>
                <Input
                  id={id("name")}
                  name="name"
                  autoComplete="name"
                  placeholder="Nome completo"
                  defaultValue={lead.name ?? ""}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? `${id("name")}-error` : undefined}
                />
              </EditField>
              <EditField htmlFor={id("phone")} label="Telefone" error={errors.phone?.[0]}>
                <Input
                  id={id("phone")}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(00) 00000-0000"
                  defaultValue={lead.phone ?? ""}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? `${id("phone")}-error` : undefined}
                />
              </EditField>
              <EditField
                htmlFor={id("instagram")}
                label="Instagram"
                error={errors.instagram_user?.[0]}
              >
                <Input
                  id={id("instagram")}
                  name="instagram_user"
                  placeholder="@usuario"
                  defaultValue={lead.instagram_user ?? ""}
                  aria-invalid={Boolean(errors.instagram_user)}
                  aria-describedby={
                    errors.instagram_user ? `${id("instagram")}-error` : undefined
                  }
                />
              </EditField>
              <EditField htmlFor={id("email")} label="E-mail" error={errors.email?.[0]}>
                <Input
                  id={id("email")}
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nome@email.com"
                  defaultValue={lead.email ?? ""}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? `${id("email")}-error` : undefined}
                />
              </EditField>
            </div>
          </EditGroup>

          <EditGroup
            icon={<GitBranchIcon />}
            title="Funil"
            description="Etapa atual e origem desta oportunidade."
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <EditField htmlFor={id("status")} label="Status" error={errors.status?.[0]}>
                <FormSelect
                  id={id("status")}
                  name="status"
                  defaultValue={lead.status}
                  aria-invalid={Boolean(errors.status)}
                  aria-describedby={errors.status ? `${id("status")}-error` : undefined}
                  options={leadStatusOrder.map((status) => ({
                    value: status,
                    label: leadStatusLabel[status],
                  }))}
                />
              </EditField>
              <EditField htmlFor={id("source")} label="Origem" error={errors.source?.[0]}>
                <FormSelect
                  id={id("source")}
                  name="source"
                  defaultValue={lead.source ?? ""}
                  aria-invalid={Boolean(errors.source)}
                  aria-describedby={errors.source ? `${id("source")}-error` : undefined}
                  options={sourceOptions.map((source) => ({
                    value: source,
                    label: leadSourceLabel[source],
                  }))}
                />
              </EditField>
            </div>
          </EditGroup>

          <EditGroup
            icon={<ClipboardCheckIcon />}
            title="Qualificação"
            description="Dados comerciais usados para priorizar o atendimento."
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <EditField
                htmlFor={id("service")}
                label="Tipo de serviço"
                error={errors.tipo_ensaio?.[0]}
              >
                <FormSelect
                  id={id("service")}
                  name="tipo_ensaio"
                  defaultValue={lead.tipo_ensaio ?? ""}
                  emptyLabel="Não informado"
                  aria-invalid={Boolean(errors.tipo_ensaio)}
                  aria-describedby={
                    errors.tipo_ensaio ? `${id("service")}-error` : undefined
                  }
                  options={tipoServicoOptions}
                />
              </EditField>
              <EditField
                htmlFor={id("value")}
                label="Valor estimado"
                error={errors.valor_estimado?.[0]}
              >
                <div className="relative min-w-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    R$
                  </span>
                  <Input
                    id={id("value")}
                    name="valor_estimado"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={10}
                    placeholder="0,00"
                    className="pl-10"
                    defaultValue={lead.valor_estimado ?? ""}
                    aria-invalid={Boolean(errors.valor_estimado)}
                    aria-describedby={
                      errors.valor_estimado ? `${id("value")}-error` : undefined
                    }
                  />
                </div>
              </EditField>
              <EditField
                htmlFor={id("recurring")}
                label="Cliente recorrente"
                error={errors.is_recorrente?.[0]}
              >
                <FormSelect
                  id={id("recurring")}
                  name="is_recorrente"
                  defaultValue={boolSelectValue(lead.is_recorrente)}
                  emptyLabel="Não informado"
                  aria-invalid={Boolean(errors.is_recorrente)}
                  aria-describedby={
                    errors.is_recorrente ? `${id("recurring")}-error` : undefined
                  }
                  options={[
                    { value: "true", label: "Sim" },
                    { value: "false", label: "Não" },
                  ]}
                />
              </EditField>
            </div>
          </EditGroup>

          <EditGroup
            icon={<NotebookPenIcon />}
            title="Anotações"
            description="Contexto útil para o próximo contato."
          >
            <div className="grid min-w-0 gap-4">
              <EditField
                htmlFor={id("interest")}
                label="Interesse"
                error={errors.interesse?.[0]}
              >
                <Input
                  id={id("interest")}
                  name="interesse"
                  placeholder="Ex.: consulta para avaliar próstata"
                  defaultValue={lead.interesse ?? ""}
                  aria-invalid={Boolean(errors.interesse)}
                  aria-describedby={
                    errors.interesse ? `${id("interest")}-error` : undefined
                  }
                />
              </EditField>
              <EditField htmlFor={id("notes")} label="Observações" error={errors.notes?.[0]}>
                <Textarea
                  id={id("notes")}
                  name="notes"
                  placeholder="Preferências, restrições e próximos passos..."
                  defaultValue={lead.notes ?? ""}
                  className="min-h-32 resize-y"
                  aria-invalid={Boolean(errors.notes)}
                  aria-describedby={errors.notes ? `${id("notes")}-error` : undefined}
                />
              </EditField>
            </div>
          </EditGroup>
        </div>
      </div>

      <div className="shrink-0 border-t border-border/70 bg-card/95 px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-6">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className="h-11 sm:h-9"
          >
            {cancelLabel}
          </Button>
          <Button type="submit" disabled={pending} className="h-11 sm:h-9">
            {pending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            Salvar alterações
          </Button>
        </div>
      </div>
    </form>
  );
}

function EditGroup({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-5 border-b border-border/70 py-6 last:border-b-0 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 lg:py-7">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4"
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function EditField({
  htmlFor,
  label,
  error,
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={htmlFor} className="justify-between gap-3 text-xs">
        <span>{label}</span>
        {error ? (
          <span id={`${htmlFor}-error`} className="font-normal text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </Label>
      <div
        className={cn(
          "min-w-0 [&_[data-slot=input]]:h-11 sm:[&_[data-slot=input]]:h-10",
          error && "[&_[data-slot=input]]:border-destructive"
        )}
      >
        {children}
      </div>
    </div>
  );
}
