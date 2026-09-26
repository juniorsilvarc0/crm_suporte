"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BotSignatureConfig } from "@/features/settings/lib/get-bot-signature";

type AgentResult = { delivered: boolean; skipped: boolean; error?: string };

export function BotSignatureSettings({ config }: { config: BotSignatureConfig }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(config.enabled);
  const [apelido, setApelido] = useState(config.apelido);
  const [saving, setSaving] = useState(false);

  // Re-sincroniza os campos quando o valor do servidor muda (após salvar/refresh).
  const serverKey = `${config.enabled}|${config.apelido}`;
  const [synced, setSynced] = useState(serverKey);
  if (serverKey !== synced) {
    setSynced(serverKey);
    setEnabled(config.enabled);
    setApelido(config.apelido);
  }

  const trimmed = apelido.trim();
  const dirty = enabled !== config.enabled || trimmed !== config.apelido;
  // Regra: ligado exige apelido. Enquanto faltar, não salva.
  const missingApelido = enabled && trimmed.length === 0;
  const canSave = dirty && !missingApelido && !saving;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/bot-signature", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, apelido: trimmed }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        agent?: AgentResult;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar.");
        return;
      }
      if (result.agent?.delivered) {
        toast.success("Assinatura do bot salva e enviada ao agente.");
      } else if (result.agent?.skipped) {
        // Sem agente configurado, o valor fica só no CRM: dizer "salva" sem
        // ressalva faria parecer que a IA já assina assim.
        toast.warning(
          "Assinatura salva no CRM, mas nenhum agente está configurado para recebê-la."
        );
      } else {
        toast.warning(
          `Salvo no CRM, mas não consegui avisar o agente${
            result.agent?.error ? ` (${result.agent.error})` : ""
          }. Salve de novo quando o agente estiver no ar.`
        );
      }
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
        <Checkbox
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          className="mt-0.5"
          aria-label="Assinar as mensagens respondidas pela IA"
        />
        <span className="grid gap-0.5 text-sm">
          <span className="font-medium">Assinar as mensagens da IA no chat</span>
          <span className="text-xs text-muted-foreground">
            Enquanto a IA responde, o contato vê o apelido abaixo. Desmarcado, as
            mensagens do bot seguem sem assinatura.
          </span>
        </span>
      </label>

      <div className="grid gap-1.5">
        <Label htmlFor="bot-apelido">Apelido do bot</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="bot-apelido"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            maxLength={40}
            autoComplete="off"
            placeholder="Ex.: Ana, Suporte N1"
            disabled={!enabled}
            aria-invalid={missingApelido}
            className="h-10"
          />
          <Button
            onClick={save}
            disabled={!canSave}
            className="h-10 shrink-0 sm:w-28"
          >
            {saving ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            Salvar
          </Button>
        </div>
        {missingApelido ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">
            Defina um apelido para assinar as mensagens do bot.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nome que assina as respostas da IA. A assinatura é aplicada pelo agente
            no momento do envio.
          </p>
        )}
      </div>
    </div>
  );
}
