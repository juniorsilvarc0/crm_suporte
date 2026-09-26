"use client";

import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  TakeOverConflict,
  TakeOverStep,
} from "@/features/tickets/hooks/use-conversation-take-over";

/** "SUP-1024 está com Ana." — sem o nome ou sem o protocolo, a frase não inventa. */
export function takeOverConflictTitle({ protocol, assigneeName }: TakeOverConflict): string {
  const subject = protocol ?? "O ticket em foco";
  return assigneeName ? `${subject} está com ${assigneeName}.` : `${subject} já está com outro analista.`;
}

/**
 * O "Assumir" do chat bateu num ticket de outro analista (409
 * `already_assigned`): tomar o ticket também, ou só a conversa.
 *
 * `compact` de propósito (UI.md §5.3): é uma pergunta de uma linha, no molde de
 * `DeleteMessageDialog`. Esc e toque fora desistem, menos com a resposta em voo.
 */
export function TakeOverDialog({
  conflict,
  pending,
  onReassign,
  onConversationOnly,
  onDismiss,
}: {
  conflict: TakeOverConflict;
  pending: TakeOverStep | null;
  onReassign: () => void;
  onConversationOnly: () => void;
  onDismiss: () => void;
}) {
  const busy = pending !== null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onDismiss();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-sans">{takeOverConflictTitle(conflict)}</DialogTitle>
          <DialogDescription>Escolha se o ticket também passa para você.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={onConversationOnly}
            className="h-11 sm:h-8"
          >
            {pending === "conversation" ? <Loader2Icon className="animate-spin" /> : null}
            Só a conversa
          </Button>
          <Button disabled={busy} onClick={onReassign} className="h-11 sm:h-8">
            {pending === "reassign" ? <Loader2Icon className="animate-spin" /> : null}
            Assumir conversa e ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
