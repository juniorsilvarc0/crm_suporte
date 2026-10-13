"use client";

import { useState } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const FAILED = "Não foi possível atualizar o cadastro do webhook.";

/**
 * Recadastra o webhook na uazapi: o mesmo endereço e o mesmo segredo, com a
 * lista de eventos atual do CRM. Não toca na sessão do WhatsApp. Serve para
 * quando a lista de eventos muda ou quando o cadastro se perde do lado da
 * uazapi (o "Reconectar" só pede o QR e não recadastra).
 */
export function WebhookRefreshButton() {
  const [pending, setPending] = useState(false);

  async function refresh() {
    setPending(true);
    try {
      const res = await fetch("/api/connection/webhook", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        toast.error(body.message ?? FAILED);
        return;
      }
      toast.success("Cadastro do webhook atualizado. A conexão não foi tocada.");
    } catch {
      toast.error(FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void refresh()}
        disabled={pending}
        className="h-11 text-muted-foreground sm:h-8"
      >
        {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
        Atualizar cadastro do webhook
      </Button>
      <p className="max-w-xs text-xs text-muted-foreground">
        Reaplica na uazapi os eventos que o CRM recebe, sem mexer na conexão.
      </p>
    </div>
  );
}
