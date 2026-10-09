"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DateTimeFields } from "@/features/appointments/components/date-time-fields";
import { followupKindOptions } from "@/features/followups/lib/followup-kind";
import type { FollowupListItem } from "@/features/followups/types";
import {
  defaultDateTimeLocalForDateKey,
  formatDateTimeLocalInput,
  getTodayAppDateKey,
} from "@/lib/formatters/date";

type MutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
};

type FollowupDialogProps = {
  /** Obrigatório ao criar (um retorno nasce de um ticket). */
  ticketId: string;
  /** Presente = edição. */
  followup?: FollowupListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Cria ou edita um retorno de um ticket. Tipo, prazo e observação — o status
 * (concluir/cancelar/reabrir) é tocado pelos botões da lista, não aqui.
 */
export function FollowupDialog({ ticketId, followup = null, open, onOpenChange }: FollowupDialogProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((current) => current + 1);
  }

  return (
    <FollowupForm
      key={`${followup?.id ?? "new"}:${session}`}
      ticketId={ticketId}
      followup={followup}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

function FollowupForm({
  ticketId,
  followup,
  open,
  onOpenChange,
}: {
  ticketId: string;
  followup: FollowupListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;

  const [kind, setKind] = useState<string>(followup?.kind ?? "retorno");
  const [when, setWhen] = useState(
    followup ? formatDateTimeLocalInput(followup.due_at) : defaultDateTimeLocalForDateKey(getTodayAppDateKey())
  );
  const [notes, setNotes] = useState(followup?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  function handleOpenChange(next: boolean) {
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!when || when.length < 16) {
      setErrors({ due_at: "Informe o prazo." });
      return;
    }

    const body = followup
      ? { kind, due_at: when, notes: notes.trim() || null }
      : { ticket_id: ticketId, kind, due_at: when, notes: notes.trim() || null };

    submitting.current = true;
    setPending(true);
    setErrors({});

    const failure = followup ? "Não foi possível salvar o retorno." : "Não foi possível criar o retorno.";

    try {
      const response = await fetch(followup ? `/api/followups/${followup.id}` : "/api/followups", {
        method: followup ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as MutationResponse;

      if (!response.ok || !result.ok) {
        const fieldErrors: Record<string, string> = {};
        for (const [field, messages] of Object.entries(result.errors ?? {})) {
          const message = messages?.[0];
          if (message) fieldErrors[field] = message;
        }
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        else toast.error(result.message ?? failure);
        return;
      }

      toast.success(followup ? "Retorno atualizado." : "Retorno criado.");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(failure);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="compact"
        title={followup ? "Editar retorno" : "Novo retorno"}
        onSubmit={submit}
        footer={
          <ModalFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {followup ? "Salvar" : "Criar retorno"}
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          <Field>
            <FieldLabel htmlFor={id("kind")}>Tipo</FieldLabel>
            <FormSelect id={id("kind")} value={kind} onValueChange={setKind} options={followupKindOptions} />
          </Field>

          <DateTimeFields value={when} onChange={setWhen} error={errors.due_at} idPrefix={id("when")} />

          <Field>
            <FieldLabel htmlFor={id("notes")}>Observações</FieldLabel>
            <Textarea
              id={id("notes")}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={5000}
              placeholder="O que precisa ser feito no retorno?"
            />
            {errors.notes ? <FieldError className="text-xs">{errors.notes}</FieldError> : null}
          </Field>
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
