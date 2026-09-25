"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RelayConfig } from "@/features/settings/lib/get-relay-url";

export function AutomationSettings({ config }: { config: RelayConfig }) {
  const router = useRouter();
  const [url, setUrl] = useState(config.configuredUrl ?? "");
  const [saving, setSaving] = useState(false);

  // Re-sincroniza o input quando o valor do servidor muda (após salvar/refresh).
  const [synced, setSynced] = useState(config.configuredUrl ?? "");
  if ((config.configuredUrl ?? "") !== synced) {
    setSynced(config.configuredUrl ?? "");
    setUrl(config.configuredUrl ?? "");
  }

  const dirty = url.trim() !== (config.configuredUrl ?? "");

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/automation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relayUrl: url.trim() }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar.");
        return;
      }
      toast.success(
        url.trim() ? "Webhook salvo." : "Campo limpo — usando o fallback do ambiente."
      );
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor="relay-url">Webhook do agente de IA</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="relay-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://seu-agente.exemplo.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-10"
        />
        <Button onClick={save} disabled={saving || !dirty} className="h-10 shrink-0 sm:w-28">
          {saving ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Salvar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        URL para onde o CRM repassa as mensagens enquanto a conversa está no modo
        IA. Deixe vazio para usar o fallback do ambiente.
      </p>
      {config.source === "env" ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Em uso: fallback do ambiente (<code className="font-mono">N8N_WEBHOOK_URL</code>) →{" "}
          <span className="font-mono break-all">{config.effectiveUrl}</span>. Preencha
          acima para sobrescrever.
        </p>
      ) : config.source === "none" ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          Nenhuma URL configurada — o CRM não está repassando as mensagens do bot.
        </p>
      ) : (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Ativo — repassando para a URL acima.
        </p>
      )}
    </div>
  );
}
