"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  ticketCommentSchema,
  type TicketCommentInput,
  type TicketCommentValues,
} from "@/features/tickets/schemas/comment";
import type { TicketComment } from "@/features/tickets/types";

/** Resposta de POST …/comments e de PATCH …/comments/[commentId]. */
type CommentMutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: { body?: string[] };
  comment?: TicketComment;
};

// Mesmo teto do schema (e de ticket_comments_body_check).
const BODY_MAX_LENGTH = 5000;

type CommentFormProps = {
  label: string;
  /** Rótulo só para leitor de tela (a edição fica dentro da própria nota). */
  labelHidden?: boolean;
  placeholder?: string;
  hint?: string;
  submitLabel: string;
  defaultBody: string;
  /** Mensagem quando a rota não diz o que houve (rede, JSON estranho). */
  failure: string;
  send: (body: string) => Promise<Response>;
  onSaved: (comment: TicketComment) => void;
  /** 404 ou 409: a tela está velha (nota apagada em outra aba, ticket sumiu). */
  onStale?: () => void;
  onCancel?: () => void;
  resetOnSave?: boolean;
  focusOnMount?: boolean;
};

/**
 * O formulário da nota, para escrever e para editar: react-hook-form com o
 * MESMO schema da rota (UI.md §5.23). Erro de campo vai para o campo; o resto
 * vira alerta junto do formulário, não toast que some. Ctrl/⌘+Enter envia;
 * Esc cancela a edição.
 */
function CommentForm({
  label,
  labelHidden = false,
  placeholder,
  hint,
  submitLabel,
  defaultBody,
  failure,
  send,
  onSaved,
  onStale,
  onCancel,
  resetOnSave = false,
  focusOnMount = false,
}: CommentFormProps) {
  const fieldId = useId();
  const id = (part: string) => `${fieldId}-${part}`;
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors },
  } = useForm<TicketCommentValues, unknown, TicketCommentInput>({
    resolver: zodResolver(ticketCommentSchema),
    defaultValues: { body: defaultBody },
  });

  useEffect(() => {
    if (focusOnMount) setFocus("body");
  }, [focusOnMount, setFocus]);

  async function onValid(values: TicketCommentInput) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFormError(null);

    try {
      const response = await send(values.body);
      const result = (await response.json().catch(() => ({}))) as CommentMutationResponse;
      if (!response.ok || !result.ok || !result.comment) {
        const message = result.errors?.body?.[0];
        if (message) setError("body", { type: "server", message }, { shouldFocus: true });
        else setFormError(result.message ?? failure);
        if (response.status === 404 || response.status === 409) onStale?.();
        return;
      }
      if (resetOnSave) reset({ body: "" });
      onSaved(result.comment);
    } catch {
      setFormError(failure);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSubmit(onValid)();
      return;
    }
    if (event.key === "Escape" && onCancel && !submitting.current) {
      event.preventDefault();
      onCancel();
    }
  }

  const describedBy = errors.body ? id("error") : hint ? id("hint") : undefined;

  return (
    <form
      noValidate
      aria-busy={pending}
      // Dentro do handler, não no render: o React Compiler não recebe uma
      // função que lê a trava (ref) de envio.
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      className="grid gap-2"
    >
      <Field>
        <FieldLabel htmlFor={id("body")} className={labelHidden ? "sr-only" : undefined}>
          {label}
        </FieldLabel>
        <Textarea
          id={id("body")}
          rows={3}
          maxLength={BODY_MAX_LENGTH}
          placeholder={placeholder}
          readOnly={pending}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={describedBy}
          // Cresce com o texto (field-sizing do primitivo) até um teto, e rola
          // por dentro sem arrastar a página junto.
          className="max-h-72 min-h-20 overflow-y-auto overscroll-contain"
          {...register("body")}
          onKeyDown={onKeyDown}
        />
        {errors.body ? (
          <FieldError id={id("error")} className="text-xs">
            {errors.body.message}
          </FieldError>
        ) : hint ? (
          <FieldDescription id={id("hint")} className="text-xs">
            {hint}
          </FieldDescription>
        ) : null}
      </Field>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onCancel}
            className="h-11 sm:h-8"
          >
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" disabled={pending} className="h-11 sm:h-8">
          {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Escreve uma nota interna no ticket (POST /api/tickets/[id]/comments). Quem
 * chama recebe a nota gravada em `onCreated` (para mostrar na hora) e faz o
 * `router.refresh()`.
 */
export function TicketCommentComposer({
  ticketId,
  onCreated,
  onStale,
}: {
  ticketId: string;
  onCreated: (comment: TicketComment) => void;
  onStale?: () => void;
}) {
  return (
    <CommentForm
      label="Nota do ticket"
      placeholder="Escreva uma nota para a equipe"
      hint="Só a equipe vê. Ctrl+Enter ou ⌘+Enter envia."
      submitLabel="Adicionar nota"
      defaultBody=""
      failure="Não foi possível adicionar a nota."
      send={(body) =>
        fetch(`/api/tickets/${encodeURIComponent(ticketId)}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        })
      }
      onSaved={onCreated}
      onStale={onStale}
      resetOnSave
    />
  );
}

/**
 * Edita a nota no lugar (PATCH …/comments/[commentId]). Só é montado para o
 * autor (canEditComment); a rota confere de novo com o mesmo predicado.
 */
export function TicketCommentEditForm({
  ticketId,
  comment,
  onSaved,
  onCancel,
  onStale,
}: {
  ticketId: string;
  comment: Pick<TicketComment, "id" | "body">;
  onSaved: (comment: TicketComment) => void;
  onCancel: () => void;
  onStale?: () => void;
}) {
  return (
    <CommentForm
      label="Editar nota"
      labelHidden
      submitLabel="Salvar"
      defaultBody={comment.body ?? ""}
      failure="Não foi possível salvar a nota."
      send={(body) =>
        fetch(
          `/api/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(comment.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          }
        )
      }
      onSaved={onSaved}
      onStale={onStale}
      onCancel={onCancel}
      focusOnMount
    />
  );
}
