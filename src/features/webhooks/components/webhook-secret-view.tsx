"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";

/**
 * O segredo de um destino, mostrado UMA vez (ao cadastrar e a cada troca).
 * Vive dentro do `Dialog` de quem o pediu, no lugar do conteúdo anterior (sem
 * modal sobre modal); quem abre passa `dismissible={false}` enquanto ele está
 * na tela, para um toque fora não levar o segredo embora.
 */
export function WebhookSecretView({
  name,
  secret,
  rotated,
  onDone,
}: {
  name: string;
  secret: string;
  rotated: boolean;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);

  // O botão que tinha o foco (o de confirmar) saiu da tela: o próximo passo é copiar.
  useEffect(() => {
    const frame = requestAnimationFrame(() => copyRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success("Segredo copiado.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  return (
    <ModalShell
      size="medium"
      title={rotated ? "Segredo trocado" : "Destino cadastrado"}
      description={`Segredo de "${name}". Copie agora: por segurança, ele não será exibido de novo.`}
      footer={
        <ModalFooterActions>
          <Button type="button" onClick={onDone} className="h-11 sm:h-9">
            Concluir
          </Button>
        </ModalFooterActions>
      }
    >
      <div className="grid gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {rotated
              ? "O segredo antigo deixou de valer. Até o destino receber este, ele recusa a assinatura e as entregas entram em nova tentativa."
              : "Configure este segredo no destino: é com ele que o destino confere a assinatura (X-CRM-Signature) de cada evento."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs whitespace-nowrap">
            {secret}
          </code>
          <Button
            ref={copyRef}
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void copy()}
            aria-label="Copiar o segredo"
            className="size-11 sm:size-9"
          >
            {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
