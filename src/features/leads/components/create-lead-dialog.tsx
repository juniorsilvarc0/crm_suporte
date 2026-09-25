"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2Icon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import {
  getLeadStatusLabel,
  leadSourceLabel,
  leadStatusLabel,
  leadStatusOrder,
  tipoServicoOptions,
} from "@/features/leads/schemas/status";
import type { BoardColumn } from "@/features/board/types";
import type { LeadSource } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/forms/form-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";

type CreatedLead = {
  id: string;
  name: string | null;
  phone: string | null;
  normalized_phone: string;
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


type StatusOption = { key: string; label: string };

export function CreateLeadDialog({
  columns,
  defaultStatus,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
}: {
  columns?: BoardColumn[];
  defaultStatus?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [createdLead, setCreatedLead] = useState<CreatedLead | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const { startConversation, checkingPhone } = useStartConversation();

  const statusOptions: StatusOption[] =
    columns && columns.length > 0
      ? columns.map((c) => ({ key: c.key, label: c.label }))
      : leadStatusOrder.map((k) => ({ key: k, label: leadStatusLabel[k] ?? k }));

  const entryStatus =
    defaultStatus ??
    statusOptions[0]?.key ??
    "novo";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData);

    try {
      const response = await fetch("/api/leads/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        ok: boolean;
        lead?: CreatedLead;
        message?: string;
        errors?: Record<string, string[]>;
      };

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar o lead.");
        return;
      }

      toast.success(result.message ?? "Lead salvo.");
      formRef.current?.reset();
      router.refresh();
      if (result.lead) setCreatedLead(result.lead);
      else setOpen(false);
    } catch {
      toast.error("Não foi possível salvar o lead.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {!hideTrigger ? (
        <Button className="h-11 sm:h-9" onClick={() => { setCreatedLead(null); setOpen(true); }}>
          <PlusIcon data-icon="inline-start" />
          Novo lead
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setCreatedLead(null); }}>
        <DialogContent className="flex h-[95dvh] w-[97vw] max-w-[97vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b border-border/70 px-5 pt-5 pb-4">
            <DialogTitle>{createdLead ? "Lead salvo" : "Novo lead"}</DialogTitle>
            <DialogDescription>
              {createdLead
                ? "O contato já está disponível em Leads e no Funil."
                : <>Cadastro manual para contatos recebidos fora da automação{defaultStatus ? ` · ${getLeadStatusLabel(defaultStatus)}` : ""}.</>}
            </DialogDescription>
          </DialogHeader>

          {createdLead ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="grid flex-1 place-items-center px-5 py-10 text-center">
                <div className="grid max-w-sm justify-items-center gap-3">
                  <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CheckCircle2Icon className="size-6" aria-hidden />
                  </span>
                  <div>
                    <p className="font-medium">{createdLead.name ?? "Lead sem nome"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{createdLead.phone ?? createdLead.normalized_phone}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Você pode concluir ou verificar o número e iniciar o atendimento no WhatsApp.
                  </p>
                </div>
              </div>
              <DialogFooter className="shrink-0 m-0 flex-col-reverse gap-2 rounded-b-xl border-t border-border/70 bg-card/95 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => { setCreatedLead(null); setOpen(false); }} className="h-11 sm:h-9">
                  Concluir
                </Button>
                <Button
                  type="button"
                  disabled={Boolean(checkingPhone)}
                  onClick={() => void startConversation(createdLead.phone ?? createdLead.normalized_phone, createdLead.name ?? undefined)}
                  className="h-11 sm:h-9"
                >
                  {checkingPhone ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <WhatsAppIcon data-icon="inline-start" brand />}
                  Conversar no WhatsApp
                </Button>
              </DialogFooter>
            </div>
          ) : (
          <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-5 overflow-y-auto px-5 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome" error={errors.name?.[0]}>
                  <Input name="name" placeholder="Ex.: Maria Souza" autoComplete="name" className="h-11" />
                </Field>

                <Field label="Telefone" error={errors.phone?.[0]} required>
                  <Input
                    name="phone"
                    placeholder="Ex.: (47) 99999-9999"
                    autoComplete="tel"
                    required
                    className="h-11"
                  />
                </Field>

                <Field label="Instagram" error={errors.instagram_user?.[0]}>
                  <Input name="instagram_user" placeholder="usuario" className="h-11" />
                </Field>

                <Field label="E-mail" error={errors.email?.[0]}>
                  <Input name="email" type="email" placeholder="nome@email.com" autoComplete="email" className="h-11" />
                </Field>

                <Field label="Origem" error={errors.source?.[0]}>
                  <FormSelect
                    name="source"
                    defaultValue="whatsapp"
                    aria-label="Origem do lead"
                    options={sourceOptions.map((source) => ({ value: source, label: leadSourceLabel[source] }))}
                  />
                </Field>

                <Field label="Categoria" error={errors.status?.[0]}>
                  <FormSelect
                    name="status"
                    defaultValue={entryStatus}
                    aria-label="Categoria do lead"
                    options={statusOptions.map((status) => ({ value: status.key, label: status.label }))}
                  />
                </Field>

                <Field label="Tipo de serviço" error={errors.tipo_ensaio?.[0]}>
                  <FormSelect
                    name="tipo_ensaio"
                    defaultValue=""
                    emptyLabel="Não informado"
                    aria-label="Tipo de serviço"
                    options={tipoServicoOptions}
                  />
                </Field>

              </div>

              <Field label="Notas" error={errors.notes?.[0]}>
                <Textarea
                  name="notes"
                  placeholder="Contexto útil para o atendimento."
                  className="min-h-24 resize-none"
                />
              </Field>
            </div>

            <DialogFooter className="shrink-0 m-0 flex-col-reverse gap-2 rounded-b-xl border-t border-border/70 bg-card/95 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="h-11 sm:h-9"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending} className="h-11 sm:h-9">
                {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Salvar lead
              </Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label className="justify-between gap-3">
        <span>
          {label}
          {required ? <span className="text-primary"> *</span> : null}
        </span>
        {error ? <span className="text-xs font-normal text-destructive">{error}</span> : null}
      </Label>
      <div className={cn(error && "[&_[data-slot=input]]:border-destructive")}>{children}</div>
    </div>
  );
}
