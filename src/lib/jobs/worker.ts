import type { SupabaseClient } from "@supabase/supabase-js";

import { checkWhatsappConnection } from "@/features/connection/server/connection-monitor";
import { reconcileExternalContracts } from "@/features/customers/server/external-contracts";
import { dispatchRelayBatch } from "@/features/integrations/server/relay-dispatch";
import { dispatchWebhookBatch } from "@/features/webhooks/server/dispatch";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

// Worker in-process dos jobs de fundo (Fase 6). Chamado por src/instrumentation.ts
// no boot, SÓ com RUN_JOBS=true. Roda em CADA réplica:
//   - sla_sweep: advisory lock PRÓPRIO (uma SQL só) garante uma por ciclo.
//   - reconciliação da TCBX e manutenção: fazem várias chamadas, então usam o
//     LEASE do banco (job_claim) para uma réplica por ciclo; o cursor da
//     reconciliação fica no lease e avança linear entre réplicas.
// Nenhum job derruba o processo.

type Admin = SupabaseClient<Database>;

const SWEEP_INTERVAL_MS = 60_000; // SLA: carimba estouro e fecha 72h
const TCBX_INTERVAL_MS = 5 * 60_000; // Espelho de contratos da TCBX fresco
const MAINTENANCE_INTERVAL_MS = 60 * 60_000; // Purga de chaves, logs e fila expirados
const RELAY_INTERVAL_MS = 20_000; // Recuperação do relay à IA (janela de 120s)
const WHATSAPP_INTERVAL_MS = 2 * 60_000; // Monitor de conexão do WhatsApp (só leitura)
const WEBHOOK_INTERVAL_MS = 20_000; // Webhooks de saída (fila com backoff)
const TCBX_BATCH = 20; // empresas por leva (teto de chamadas à TCBX por ciclo)

/** Pega o lease de um job. `claimed:false` = outra réplica está rodando. */
async function claim(
  supabase: Admin,
  name: string,
  seconds: number
): Promise<{ claimed: boolean; cursor: string | null }> {
  const { data, error } = await supabase.rpc("job_claim", { p_name: name, p_seconds: seconds });
  if (error) {
    console.error("[jobs] job_claim", name, error.code, error.message);
    return { claimed: false, cursor: null };
  }
  const lease = data as { claimed?: boolean; cursor?: string | null } | null;
  return { claimed: lease?.claimed === true, cursor: lease?.cursor ?? null };
}

/** Carimba o estouro de SLA e fecha o resolvido após 72h. Nunca lança. */
export async function runSlaSweep(supabase: Admin): Promise<void> {
  try {
    const { error } = await supabase.rpc("sla_sweep");
    if (error) console.error("[jobs] sla_sweep", error.code, error.message);
  } catch (error) {
    console.error("[jobs] sla_sweep lançou", error);
  }
}

/**
 * Mantém o espelho de contratos da TCBX fresco: uma leva por ciclo, avançando o
 * cursor compartilhado — passa por todas as empresas com CNPJ e recomeça. A
 * fonte desligada (not_configured) ou o fim da volta zeram o cursor. Nunca lança.
 */
export async function runTcbxReconcile(supabase: Admin): Promise<void> {
  try {
    const lease = await claim(supabase, "tcbx_reconcile", 290);
    if (!lease.claimed) return;
    const report = await reconcileExternalContracts(supabase, {
      limit: TCBX_BATCH,
      after: lease.cursor,
    });
    // "" = recomeçar do início (o reconcile trata vazio/null como sem cursor);
    // a fonte desligada ou o fim da volta zeram o cursor.
    const next = report.notConfigured || report.done ? "" : (report.cursor ?? "");
    const { error } = await supabase.rpc("job_cursor_set", {
      p_name: "tcbx_reconcile",
      p_cursor: next,
    });
    if (error) console.error("[jobs] job_cursor_set tcbx", error.code, error.message);
  } catch (error) {
    console.error("[jobs] tcbx_reconcile", error);
  }
}

/**
 * Recuperação do relay à IA: drena os eventos de relay que a tentativa imediata
 * do webhook não entregou (processo caiu, agente fora do ar). O claim do outbox
 * serializa por evento, então NÃO usa lease de job — todas as réplicas ajudam.
 * Nunca lança.
 */
export async function runRelayDispatch(supabase: Admin): Promise<void> {
  try {
    await dispatchRelayBatch(supabase);
  } catch (error) {
    console.error("[jobs] relay_dispatch", error);
  }
}

// Um ciclo de webhooks por vez neste processo: com destino lento, uma leva leva
// até 50 s (5 × 10 s) e o intervalo é de 20 s. A fila já não entrega em dobro;
// a trava só evita empilhar levas.
let webhookDispatchRunning = false;

/**
 * Webhooks de saída: drena a fila `webhook` do outbox (assina e envia). Como o
 * relay, o claim serializa por evento — sem lease de job, as réplicas ajudam.
 * Nunca lança.
 */
export async function runWebhookDispatch(supabase: Admin): Promise<void> {
  if (webhookDispatchRunning) return;
  webhookDispatchRunning = true;
  try {
    await dispatchWebhookBatch(supabase);
  } catch (error) {
    console.error("[jobs] webhook_dispatch", error);
  } finally {
    webhookDispatchRunning = false;
  }
}

/**
 * Monitor de conexão do WhatsApp: lê o status da instância (só leitura, nunca
 * toca a sessão) e grava quando o estado muda. Lease de job: uma réplica por
 * ciclo, senão as duas gravariam a mesma mudança. Nunca lança.
 */
export async function runWhatsappMonitor(supabase: Admin): Promise<void> {
  try {
    const lease = await claim(supabase, "whatsapp_monitor", 110);
    if (!lease.claimed) return;
    await checkWhatsappConnection(supabase);
  } catch (error) {
    console.error("[jobs] whatsapp_monitor", error);
  }
}

/**
 * Purga chaves de idempotência, logs de integração (90 dias) e as entregas
 * encerradas da fila (30 dias). Nunca lança.
 */
export async function runMaintenance(supabase: Admin): Promise<void> {
  try {
    const lease = await claim(supabase, "maintenance", 3500);
    if (!lease.claimed) return;
    for (const fn of ["api_idempotency_purge", "purge_integration_logs", "outbox_purge"] as const) {
      const { error } = await supabase.rpc(fn);
      if (error) console.error(`[jobs] ${fn}`, error.code, error.message);
    }
  } catch (error) {
    console.error("[jobs] maintenance", error);
  }
}

/**
 * Inicia o worker. Guarda em globalThis para o HMR do dev não duplicar os
 * intervalos. Sem Supabase admin, não inicia (loga). Os timers são `unref`.
 */
export function startJobs(): void {
  const store = globalThis as typeof globalThis & { __crmsupJobsStarted?: boolean };
  if (store.__crmsupJobsStarted) return;
  if (!hasSupabaseAdminEnv()) {
    console.warn("[jobs] Supabase admin ausente — worker não iniciado.");
    return;
  }
  store.__crmsupJobsStarted = true;
  console.info("[jobs] worker iniciado (SLA 60s · relay 20s · webhooks 20s · WhatsApp 2min · TCBX 5min · manutenção 1h).");

  const supabase = createSupabaseAdminClient();
  const schedule = (fn: () => void, ms: number) => setInterval(fn, ms).unref?.();

  const sla = () => void runSlaSweep(supabase);
  const relay = () => void runRelayDispatch(supabase);
  const tcbx = () => void runTcbxReconcile(supabase);
  const maintenance = () => void runMaintenance(supabase);
  const whatsapp = () => void runWhatsappMonitor(supabase);
  const webhooks = () => void runWebhookDispatch(supabase);

  // Tentativas imediatas no boot: drena o que ficou pendente antes do restart
  // (manutenção não precisa).
  sla();
  relay();
  tcbx();
  whatsapp();
  webhooks();
  schedule(sla, SWEEP_INTERVAL_MS);
  schedule(relay, RELAY_INTERVAL_MS);
  schedule(tcbx, TCBX_INTERVAL_MS);
  schedule(maintenance, MAINTENANCE_INTERVAL_MS);
  schedule(whatsapp, WHATSAPP_INTERVAL_MS);
  schedule(webhooks, WEBHOOK_INTERVAL_MS);
}
