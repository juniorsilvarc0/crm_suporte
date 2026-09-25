"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
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
import type { QuickReply } from "@/features/quick-replies/types";

type FieldErrors = Record<string, string[]>;

/**
 * Criar e editar resposta rápida.
 *
 * ⚠️ **Quem abre este diálogo fecha o próprio popup antes** (ver
 * `quick-reply-picker`). No celular o seletor já é uma gaveta, e gaveta dentro
 * de gaveta é o anti-padrão do `UI.md` §9 — dois backdrops, dois donos do Esc.
 */
export function QuickReplyFormDialog({
  open,
  item,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** `null` cria; um item edita. */
  item: QuickReply | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: QuickReply) => void;
}) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const editing = item !== null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      title: form.get("title"),
      shortcut: form.get("shortcut"),
      content: form.get("content"),
      is_active: form.get("is_active") !== "false",
    };

    try {
      const response = await fetch(
        editing ? `/api/quick-replies/${item.id}` : "/api/quick-replies",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        item?: QuickReply;
        message?: string;
        errors?: FieldErrors;
      };

      if (!response.ok || !result.ok || !result.item) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar a resposta rápida.");
        return;
      }

      toast.success(result.message ?? "Resposta rápida salva.");
      onSaved(result.item);
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar a resposta rápida.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // O guard cobre X, Esc e clique fora de uma vez (UI.md §5.5).
        if (!next && pending) return;
        if (!next) setErrors({});
        onOpenChange(next);
      }}
    >
      {open ? (
        <ModalShell
          size="medium"
          title={editing ? "Editar resposta rápida" : "Nova resposta rápida"}
          description="O atalho ajuda a localizar a mensagem; o texto só é enviado depois da revisão no chat."
          onSubmit={save}
          footer={
            <ModalFooterActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="h-11 sm:h-9"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending} className="h-11 sm:h-9">
                {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                Salvar resposta
              </Button>
            </ModalFooterActions>
          }
        >
          {/*
            `key` remonta os campos ao trocar de alvo: são inputs não
            controlados (`defaultValue`), então sem isto editar a resposta B
            depois da A mostraria o texto da A.
          */}
          <div className="grid gap-4" key={item?.id ?? "new"}>
            <FormField label="Título" error={errors.title?.[0]} htmlFor="quick-reply-title">
              <Input
                id="quick-reply-title"
                name="title"
                defaultValue={item?.title ?? ""}
                placeholder="Ex.: Valores da consulta"
                maxLength={80}
                required
              />
            </FormField>

            <FormField label="Atalho" error={errors.shortcut?.[0]} htmlFor="quick-reply-shortcut">
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground"
                  aria-hidden
                >
                  /
                </span>
                <Input
                  id="quick-reply-shortcut"
                  name="shortcut"
                  defaultValue={item?.shortcut ?? ""}
                  placeholder="valores"
                  maxLength={40}
                  className="pl-7 font-mono"
                  autoCapitalize="none"
                  required
                />
              </div>
            </FormField>

            <FormField label="Mensagem" error={errors.content?.[0]} htmlFor="quick-reply-content">
              <Textarea
                id="quick-reply-content"
                name="content"
                defaultValue={item?.content ?? ""}
                placeholder="Digite a mensagem completa..."
                maxLength={4000}
                className="min-h-40 resize-y"
                required
              />
            </FormField>

            <FormField label="Status" error={errors.is_active?.[0]} htmlFor="quick-reply-status">
              <FormSelect
                id="quick-reply-status"
                name="is_active"
                defaultValue={item && !item.is_active ? "false" : "true"}
                options={[
                  { value: "true", label: "Ativa" },
                  { value: "false", label: "Inativa" },
                ]}
              />
            </FormField>
          </div>
        </ModalShell>
      ) : null}
    </Dialog>
  );
}

export function QuickReplyDeleteDialog({
  item,
  onCancel,
  onDeleted,
}: {
  item: QuickReply;
  onCancel: () => void;
  onDeleted: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);

  async function remove() {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/quick-replies/${item.id}`, { method: "DELETE" });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível excluir a resposta rápida.");
        return;
      }
      toast.success(result.message ?? "Resposta rápida excluída.");
      onDeleted(item.id);
    } catch {
      toast.error("Não foi possível excluir a resposta rápida.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir resposta rápida?</DialogTitle>
          <DialogDescription>
            A resposta “{item.title}” será removida para toda a equipe. Não dá para desfazer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void remove()}
            disabled={pending}
          >
            {pending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <Trash2Icon data-icon="inline-start" />
            )}
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="justify-between gap-3">
        <span>{label}</span>
        {error ? <span className="text-xs font-normal text-destructive">{error}</span> : null}
      </Label>
      {children}
    </div>
  );
}
