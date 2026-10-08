import type { SupabaseClient } from "@supabase/supabase-js";

import { reconcileExternalContracts } from "@/features/customers/server/external-contracts";
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
const MAINTENANCE_INTERVAL_MS = 60 * 60_000; // Purga de chaves/logs expirados
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

/** Purga chaves de idempotência e logs de integração expirados. Nunca lança. */
export async function runMaintenance(supabase: Admin): Promise<void> {
  try {
    const lease = await claim(supabase, "maintenance", 3500);
    if (!lease.claimed) return;
    for (const fn of ["api_idempotency_purge", "purge_integration_logs"] as const) {
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
  console.info("[jobs] worker iniciado (SLA 60s · TCBX 5min · manutenção 1h).");

  const supabase = createSupabaseAdminClient();
  const schedule = (fn: () => void, ms: number) => setInterval(fn, ms).unref?.();

  const sla = () => void runSlaSweep(supabase);
  const tcbx = () => void runTcbxReconcile(supabase);
  const maintenance = () => void runMaintenance(supabase);

  // Tentativas imediatas no boot (manutenção não precisa).
  sla();
  tcbx();
  schedule(sla, SWEEP_INTERVAL_MS);
  schedule(tcbx, TCBX_INTERVAL_MS);
  schedule(maintenance, MAINTENANCE_INTERVAL_MS);
}
