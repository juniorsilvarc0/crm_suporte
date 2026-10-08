"use client";

import { useId, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Loader2Icon } from "lucide-react";

import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { formatProtocol } from "@/features/tickets/lib/protocol";
import { postTicketAction, type TicketRequestFailure } from "@/features/tickets/lib/ticket-request";
import { ticketTransitionSchema } from "@/features/tickets/schemas/ticket";
import type { TicketListItem } from "@/features/tickets/types";

// "Mover para Cancelado" pede motivo (a rota exige; a RPC confere de novo).
// Compartilhado pela lista (tickets-table) e pelo quadro (tickets-board): um só
// caminho, com a versão que a tela leu.

type CancelFormValues = z.input<typeof ticketTransitionSchema>;
type CancelFormOutput = z.output<typeof ticketTransitionSchema>;

/** O que o diálogo precisa do ticket: id, protocolo, título e a versão lida. */
export type CancelTicketTarget = Pick<TicketListItem, "id" | "number" | "title" | "version">;

export type CancelTicketDialogProps<T extends CancelTicketTarget> = {
  ticket: T | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled: (ticket: T) => void;
  onFailure: (ticket: T, result: TicketRequestFailure) => void;
};

/**
 * Cada abertura é um formulário novo, com a versão que a tela leu. Dois estados
 * (`open` e o ticket): fechar não zera o ticket, senão o conteúdo sumiria no
 * meio da animação de saída. Genérico no ticket: preserva o tipo de quem chama
 * (a lista passa TicketListItem; o quadro, o item dele).
 */
export function CancelTicketDialog<T extends CancelTicketTarget>({
  ticket,
  open,
  ...props
}: CancelTicketDialogProps<T>) {
  // Ajuste durante o render: o estado do react-hook-form sobreviveria entre
  // aberturas, com o motivo da anterior.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((current) => current + 1);
  }

  if (!ticket) return null;
  return <CancelTicketForm key={`${ticket.id}:${session}`} ticket={ticket} open={open} {...props} />;
}

function CancelTicketForm<T extends CancelTicketTarget>({
  ticket,
  open,
  onOpenChange,
  onCancelled,
  onFailure,
}: Omit<CancelTicketDialogProps<T>, "ticket"> & { ticket: T }) {
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);
  const protocol = formatProtocol(ticket.number);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CancelFormValues, unknown, CancelFormOutput>({
    resolver: zodResolver(ticketTransitionSchema),
    defaultValues: { to: "cancelado", version: ticket.version, reason: "" },
  });

  function handleOpenChange(next: boolean) {
    // Não fecha no meio do envio: a resposta ainda vai pintar erro aqui.
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function onValid(values: CancelFormOutput) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    const result = await postTicketAction(ticket.id, "transition", values);
    submitting.current = false;
    setPending(false);

    if (result.ok) {
      onOpenChange(false);
      onCancelled(ticket);
      return;
    }
    const reasonError = result.body?.errors?.reason?.[0];
    if (reasonError) {
      setError("reason", { type: "server", message: reasonError }, { shouldFocus: true });
      return;
    }
    // Conflito: o ticket mudou, e o motivo já não vale para o que está lá.
    if (result.status === 409 || result.status === 404) onOpenChange(false);
    onFailure(ticket, result);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="compact"
        title={`Cancelar ${protocol}?`}
        description={ticket.title}
        onSubmit={(event) => void handleSubmit(onValid)(event)}
        footer={
          <ModalFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              Cancelar ticket
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-reason`}>
              <span>
                Motivo do cancelamento<span className="text-primary" aria-hidden> *</span>
              </span>
            </FieldLabel>
            <Textarea
              id={`${fieldId}-reason`}
              rows={3}
              maxLength={500}
              aria-required
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? `${fieldId}-reason-error` : undefined}
              {...register("reason")}
            />
            <FieldError id={`${fieldId}-reason-error`} className="text-xs">
              {errors.reason?.message}
            </FieldError>
          </Field>
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
