"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, RotateCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConnectionEvent } from "@/features/connection/types";
import type { IntegrationHealth } from "@/features/integrations/types";
import { formatDateTime, formatTime } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";

type Tone = "ok" | "warn" | "bad" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  muted: "text-muted-foreground",
};

type Line = { text: string; tone: Tone };

// Cada parte diz o próprio estado, sempre com texto (UI §1.4). `unavailable`
// nunca vira zero nem "nunca": é "não foi possível ler".

function whatsappStatus(whatsapp: IntegrationHealth["whatsapp"]): Line {
  switch (whatsapp.state) {
    case "not_configured":
      return { text: "Nenhuma instância configurada.", tone: "warn" };
    case "unavailable":
      return whatsapp.cause === "provider"
        ? { text: "A uazapi não respondeu agora.", tone: "bad" }
        : { text: "Não foi possível ler a integração no CRM.", tone: "warn" };
    case "open":
      return { text: "Conectado.", tone: "ok" };
    case "connecting":
      return { text: "Conectando.", tone: "warn" };
    case "close":
      return { text: "Desconectado.", tone: "bad" };
    default:
      return { text: "Estado desconhecido.", tone: "warn" };
  }
}

/** O estado e, quando se sabe, o número da instância numa linha à parte. */
function whatsappLines(whatsapp: IntegrationHealth["whatsapp"]): Line[] {
  const lines = [whatsappStatus(whatsapp)];
  if ("instance" in whatsapp && whatsapp.instance) {
    lines.push({ text: `Número: ${formatPhone(whatsapp.instance)}.`, tone: "muted" });
  }
  return lines;
}

const CONNECTION_STATE: Record<ConnectionEvent["state"], { text: string; tone: Tone }> = {
  open: { text: "Conectado", tone: "ok" },
  connecting: { text: "Esperando o QR", tone: "warn" },
  close: { text: "Desconectado", tone: "bad" },
  unknown: { text: "Sem resposta da uazapi", tone: "warn" },
};

/**
 * As mudanças de estado gravadas pelo monitor (a cada 2 minutos), da mais nova
 * para a mais antiga, com o motivo quando a uazapi o informa.
 */
function connectionHistoryLines(history: IntegrationHealth["connectionHistory"]): Line[] {
  if (history.state === "unavailable") return [{ text: "Não foi possível ler o histórico.", tone: "warn" }];
  if (history.events.length === 0) {
    return [{ text: "Nenhuma mudança registrada ainda: o monitor grava quando o estado muda.", tone: "muted" }];
  }
  return history.events.map((event) => {
    const state = CONNECTION_STATE[event.state];
    return {
      text: `${formatDateTime(event.occurredAt)} · ${state.text}${event.reason ? ` (${event.reason})` : ""}.`,
      tone: state.tone,
    };
  });
}

function lastInboundLine(lastInbound: IntegrationHealth["lastInbound"]): Line {
  if (lastInbound.state === "unavailable") return { text: "Não foi possível ler as mensagens.", tone: "warn" };
  if (lastInbound.at === null) {
    return lastInbound.exact
      ? { text: "Nenhuma mensagem recebida ainda.", tone: "muted" }
      : { text: "Nenhuma mensagem recebida nas 50 conversas mais recentes.", tone: "muted" };
  }
  const when = formatDateTime(lastInbound.at);
  return lastInbound.exact
    ? { text: when, tone: "muted" }
    : { text: `${when} ou mais recente (só as 50 conversas mais recentes foram olhadas).`, tone: "muted" };
}

function relayConfigLine(relay: IntegrationHealth["relay"]): Line {
  switch (relay.config) {
    case "active":
      return { text: "Ativo.", tone: "ok" };
    case "none":
      return { text: "Nenhuma URL configurada: o CRM não repassa as mensagens.", tone: "bad" };
    case "refused":
      return { text: `URL recusada, nada é repassado.${relay.reason ? ` Motivo: ${relay.reason}` : ""}`, tone: "bad" };
    default:
      return { text: "Não foi possível ler a configuração do agente.", tone: "warn" };
  }
}

function deliveriesLines(deliveries: IntegrationHealth["relay"]["deliveries"], hours: number): Line[] {
  if (deliveries.state === "unavailable") return [{ text: "Não foi possível ler os repasses.", tone: "warn" }];
  if (deliveries.total === 0) return [{ text: `Nenhum repasse nas últimas ${hours} h.`, tone: "muted" }];
  const lines: Line[] = [
    {
      text: `${deliveries.errors} de ${deliveries.total} com erro nas últimas ${hours} h.`,
      tone: deliveries.errors > 0 ? "bad" : "ok",
    },
  ];
  if (deliveries.lastOkAt) lines.push({ text: `Último entregue: ${formatDateTime(deliveries.lastOkAt)}.`, tone: "muted" });
  if (deliveries.lastErrorAt) lines.push({ text: `Último com erro: ${formatDateTime(deliveries.lastErrorAt)}.`, tone: "muted" });
  return lines;
}

function apiLines(calls: IntegrationHealth["api"]["calls"], hours: number): Line[] {
  if (calls.state === "unavailable") return [{ text: "Não foi possível ler as chamadas.", tone: "warn" }];
  if (calls.total === 0) return [{ text: `Nenhuma chamada registrada nas últimas ${hours} h.`, tone: "muted" }];
  return [
    { text: `${calls.total} ${calls.total === 1 ? "chamada" : "chamadas"} nas últimas ${hours} h.`, tone: "muted" },
    {
      text: `${calls.clientErrors} recusadas por erro de quem chamou (4xx) e ${calls.serverErrors} com erro do CRM (5xx).`,
      tone: calls.serverErrors > 0 ? "bad" : calls.clientErrors > 0 ? "warn" : "ok",
    },
  ];
}

/** Os webhooks de saída: destinos ativos, entregas da janela e o que está em nova tentativa agora. */
function webhooksLines(webhooks: IntegrationHealth["webhooks"], hours: number): Line[] {
  if (webhooks.state === "unavailable") return [{ text: "Não foi possível ler os webhooks.", tone: "warn" }];
  const { activeDestinations, sent, dead, retrying, lastSentAt } = webhooks;
  if (activeDestinations === 0 && sent === 0 && dead === 0 && retrying === 0) {
    return [{ text: "Nenhum destino ativo.", tone: "muted" }];
  }
  const lines: Line[] = [
    {
      text:
        activeDestinations === 0
          ? "Nenhum destino ativo."
          : `${activeDestinations} ${activeDestinations === 1 ? "destino ativo" : "destinos ativos"}.`,
      tone: "muted",
    },
    {
      text: `${sent} ${sent === 1 ? "entregue" : "entregues"} e ${dead} ${dead === 1 ? "esgotada" : "esgotadas"} nas últimas ${hours} h.`,
      tone: dead > 0 ? "bad" : sent > 0 ? "ok" : "muted",
    },
  ];
  if (retrying > 0) lines.push({ text: `${retrying} em nova tentativa agora.`, tone: "warn" });
  if (lastSentAt) lines.push({ text: `Última entregue: ${formatDateTime(lastSentAt)}.`, tone: "muted" });
  if (dead > 0 || retrying > 0) lines.push({ text: "Detalhes e reenvio na aba Webhooks.", tone: "muted" });
  return lines;
}

function Section({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <div className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm font-medium">{title}</dt>
      <dd className="grid gap-0.5">
        {lines.map((line) => (
          <p key={line.text} className={`text-sm ${TONE_CLASS[line.tone]}`}>
            {line.text}
          </p>
        ))}
      </dd>
    </div>
  );
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; health: IntegrationHealth };

const READ_FAILED = "Não foi possível ler a saúde das integrações.";

/** Uma leitura da Saúde. Nunca rejeita: a falha vira o estado de erro, com o motivo. */
async function fetchHealth(): Promise<Load> {
  try {
    const res = await fetch("/api/connection/health", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as
      | { ok: true; health: IntegrationHealth }
      | { ok: false; message?: string }
      | null;
    if (!res.ok || !body || !body.ok) {
      return { state: "error", message: (body && !body.ok && body.message) || READ_FAILED };
    }
    return { state: "ok", health: body.health };
  } catch {
    return { state: "error", message: READ_FAILED };
  }
}

/**
 * Aba Saúde de Integrações. Pede `GET /api/connection/health` ao abrir a aba
 * (a aba desmonta ao sair, então cada abertura lê de novo) e no "Atualizar". A
 * leitura chama o provedor e pode levar segundos: nunca é aguardada no render da
 * página. O servidor guarda cada leitura por 10 s, e a tela diz de quando ela é.
 */
export function IntegrationHealthPanel() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(true);
  const mounted = useRef(false);

  const apply = useCallback((result: Load) => {
    if (!mounted.current) return;
    setLoad(result);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchHealth().then(apply);
    return () => {
      mounted.current = false;
    };
  }, [apply]);

  function refresh() {
    setRefreshing(true);
    void fetchHealth().then(apply);
  }

  const refreshButton = (
    <Button type="button" variant="outline" onClick={refresh} disabled={refreshing} className="h-11 sm:h-9">
      {refreshing ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RotateCwIcon data-icon="inline-start" />}
      Atualizar
    </Button>
  );

  return (
    <section className="grid min-w-0 gap-4" aria-busy={refreshing}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {load.state === "ok"
            ? `Lido às ${formatTime(load.health.generatedAt)}. Uma leitura vale por alguns segundos.`
            : load.state === "loading"
              ? "Lendo a saúde das integrações…"
              : null}
        </p>
        {refreshButton}
      </div>

      {load.state === "loading" ? (
        <div className="grid gap-4 rounded-xl border border-border/60 bg-card p-4 shadow-soft">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-5 w-full max-w-xl" />
          ))}
        </div>
      ) : load.state === "error" ? (
        <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-amber-600 shadow-soft dark:text-amber-400">
          {load.message}
        </p>
      ) : (
        <dl className="divide-y divide-border/70 rounded-xl border border-border/60 bg-card p-4 shadow-soft">
          <Section title="WhatsApp" lines={whatsappLines(load.health.whatsapp)} />
          <Section title="Última mensagem recebida" lines={[lastInboundLine(load.health.lastInbound)]} />
          <Section title="Histórico da conexão" lines={connectionHistoryLines(load.health.connectionHistory)} />
          <Section title="Agente de IA" lines={[relayConfigLine(load.health.relay)]} />
          <Section
            title="Repasse ao agente"
            lines={deliveriesLines(load.health.relay.deliveries, load.health.windowHours)}
          />
          <Section title="API do CRM" lines={apiLines(load.health.api.calls, load.health.windowHours)} />
          <Section title="Webhooks" lines={webhooksLines(load.health.webhooks, load.health.windowHours)} />
        </dl>
      )}
    </section>
  );
}
