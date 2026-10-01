"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, PlugZapIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PingResult } from "@/features/integrations/server/relay-ping";
import type { RelayConfig } from "@/features/settings/lib/get-relay-url";

// O desfecho do teste, em uma frase. Diz PARA ONDE foi (a URL salva pode não ser
// a do campo de quem testa), o que voltou, e se o pedido levou assinatura (é o
// que explica um 401 de um agente que a confere). "Enviado com assinatura" não
// é "assinatura aceita": o teste não prova que o agente a confere.
function describePing(result: PingResult): { delivered: boolean; message: string } {
  if (!result.sent) return { delivered: false, message: result.error };

  // Sem resposta HTTP (rede ou prazo), a assinatura não explica nada.
  if (result.httpStatus === null) {
    return { delivered: false, message: `${result.host}: ${result.error ?? "sem resposta."}` };
  }

  const signature = result.signed
    ? "Pedido enviado com assinatura."
    : "Pedido enviado sem assinatura: não há chave.";
  if (!result.delivered) {
    const redirect =
      result.httpStatus >= 300 && result.httpStatus < 400
        ? " O CRM não segue redirecionamento: salve o endereço final."
        : "";
    return {
      delivered: false,
      message: `${result.host} respondeu HTTP ${result.httpStatus}.${redirect} ${signature}`,
    };
  }
  const latency = result.latencyMs === null ? "" : ` em ${result.latencyMs} ms`;
  return {
    delivered: true,
    message: `${result.host} respondeu HTTP ${result.httpStatus}${latency}. ${signature}`,
  };
}

export function AutomationSettings({ config }: { config: RelayConfig }) {
  const router = useRouter();
  const [url, setUrl] = useState(config.configuredUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Re-sincroniza o input quando o valor do servidor muda (após salvar/refresh).
  const [synced, setSynced] = useState(config.configuredUrl ?? "");
  if ((config.configuredUrl ?? "") !== synced) {
    setSynced(config.configuredUrl ?? "");
    setUrl(config.configuredUrl ?? "");
  }

  const dirty = url.trim() !== (config.configuredUrl ?? "");
  // A leitura falhou: o campo vazio não quer dizer "sem URL". Travado, para o
  // administrador não gravar por cima de uma URL que ele não chegou a ver (sem
  // digitar, o Salvar nunca habilita).
  const unreadable = config.state === "unreadable";
  // O teste vai à URL SALVA, pelo caminho do repasse. Com o campo alterado, ele
  // não testaria o que está à vista; com a URL recusada, nada sairia.
  const canTest = config.state === "active" && !dirty;

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch("/api/connection/agent/test", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        result?: PingResult;
      };
      if (!res.ok || !body.ok || !body.result) {
        toast.error(body.message ?? "Não foi possível testar a conexão.");
        return;
      }
      const outcome = describePing(body.result);
      if (outcome.delivered) toast.success(outcome.message);
      else toast.error(outcome.message);
    } catch {
      toast.error("Não foi possível testar a conexão.");
    } finally {
      setTesting(false);
    }
  }

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
      toast.success(url.trim() ? "Webhook salvo." : "Campo limpo: o repasse está desligado.");
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
          disabled={unreadable}
          className="h-10"
        />
        <Button onClick={save} disabled={saving || !dirty} className="h-10 shrink-0 sm:w-28">
          {saving ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : null}
          Salvar
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={testConnection}
          disabled={testing || !canTest}
          className="h-11 shrink-0 sm:h-10"
        >
          {testing ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <PlugZapIcon data-icon="inline-start" />
          )}
          Testar conexão
        </Button>
      </div>
      {dirty ? (
        <p className="text-xs text-muted-foreground">
          O teste vai à URL salva: salve antes de testar.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        URL para onde o CRM repassa as mensagens enquanto a conversa está no modo
        IA. Deixe vazio para desligar o repasse.
      </p>
      {config.state === "unreadable" ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Não foi possível ler a configuração agora. Recarregue a página antes de
          alterar.
        </p>
      ) : config.state === "none" ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          Nenhuma URL configurada — o CRM não está repassando as mensagens do bot.
        </p>
      ) : config.state === "refused" ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">
          A URL salva é recusada no envio, e nada está sendo repassado. Motivo:{" "}
          {config.reason}
        </p>
      ) : (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Ativo — repassando para a URL acima.
        </p>
      )}
    </div>
  );
}
