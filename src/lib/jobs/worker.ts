import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

// Worker in-process dos jobs de fundo (Fase 6). Hoje: a varredura de SLA
// (sla_sweep). Chamado por src/instrumentation.ts no boot, SÓ com RUN_JOBS=true.
// Em produção roda em CADA réplica; o advisory lock dentro de sla_sweep garante
// que só uma varre por ciclo (as outras pulam). Nunca derruba o processo.

const SWEEP_INTERVAL_MS = 60_000;

/** Um ciclo: carimba o estouro de SLA e fecha o resolvido após 72h. Nunca lança. */
export async function runSlaSweep(supabase: SupabaseClient<Database>): Promise<void> {
  try {
    const { error } = await supabase.rpc("sla_sweep");
    if (error) console.error("[jobs] sla_sweep", error.code, error.message);
  } catch (error) {
    console.error("[jobs] sla_sweep lançou", error);
  }
}

/**
 * Inicia o worker. Guarda em globalThis para o HMR do dev não duplicar o
 * intervalo. Sem Supabase admin, não inicia (loga). O timer é `unref` para não
 * segurar o processo vivo sozinho.
 */
export function startJobs(): void {
  const store = globalThis as typeof globalThis & { __crmsupJobsStarted?: boolean };
  if (store.__crmsupJobsStarted) return;
  if (!hasSupabaseAdminEnv()) {
    console.warn("[jobs] Supabase admin ausente — worker não iniciado.");
    return;
  }
  store.__crmsupJobsStarted = true;
  console.info("[jobs] worker iniciado (sla_sweep a cada 60s).");

  const supabase = createSupabaseAdminClient();
  const tick = () => void runSlaSweep(supabase);
  tick(); // tentativa imediata no boot
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref?.();
}
