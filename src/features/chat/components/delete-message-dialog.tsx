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

/**
 * Confirmação de apagar.
 *
 * Existe porque a ação é **irreversível e sai da nossa mão**: o WhatsApp apaga
 * a mensagem do celular do paciente e não há como desfazer. Um item de menu que
 * dispara isso no primeiro clique é um erro esperando acontecer — e o próprio
 * WhatsApp confirma antes.
 *
 * `compact` de propósito (UI.md §5.3): é confirmação de uma linha, não
 * formulário.
 */
export function DeleteMessageDialog({
  deleting,
  isNote = false,
  onCancel,
  onConfirm,
}: {
  deleting: boolean;
  /** Anotação interna: nunca foi ao paciente, então a promessa é outra. */
  isNote?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !deleting) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-sans">{isNote ? "Apagar anotação?" : "Apagar mensagem?"}</DialogTitle>
          <DialogDescription>
            {isNote
              ? "Ela some para toda a equipe. O contato nunca a viu. Não dá para desfazer."
              : "Ela será apagada para você e para o contato. Não dá para desfazer."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? <Loader2Icon className="animate-spin" /> : null}
            Apagar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
