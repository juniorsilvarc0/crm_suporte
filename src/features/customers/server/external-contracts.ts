import type { SupabaseClient } from "@supabase/supabase-js";

import { getCustomerContext } from "@/features/customer-source/get-customer-context";
import type { CustomerContract } from "@/features/customer-source/types";
import type { ReconcileContractsReport } from "@/features/customers/types";
import type { Database } from "@/lib/supabase/types";

// Sincronização do ESPELHO read-only de contratos da fonte externa (TCBX) na
// tabela external_contracts. A TCBX é a fonte da verdade: o CRM só reflete o
// que ela devolve, nunca cria nem edita contrato à mão.
//
// O espelho não comporta o contrato interno (support_contracts) e vice-versa:
// este guarda o que a TCBX manda (sem valor, sem fila), só para saber que o
// cliente tem contrato ativo e pode receber suporte.

type Admin = SupabaseClient<Database>;

const PROVIDER = "tcbx" as const;

export type SyncContractsResult =
  | { state: "ok"; upserted: number; active: number }
  // A fonte não tem o cliente: o espelho dele foi esvaziado.
  | { state: "not_found" }
  | { state: "not_configured" }
  | { state: "unavailable" }
  | { state: "ambiguous" }
  // Empresa sem CNPJ: não há chave de consulta.
  | { state: "skipped" };

// Só datas ISO (yyyy-mm-dd) entram na coluna `date`; a fonte não promete o
// formato, então o que não casa vira null em vez de derrubar a gravação inteira.
function isoDate(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

// A coluna aceita 1..31 (check do banco); fora disso, null — o espelho não
// quebra por um dia estranho vindo da fonte.
function billingDay(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31
    ? value
    : null;
}

function isActive(statusVigencia: string | null, status: string | null): boolean {
  return (statusVigencia ?? status ?? "").trim().toLowerCase() === "ativo";
}

/**
 * Grava no espelho os contratos JÁ LIDOS da fonte (reaproveita o contexto que o
 * import ou a reconciliação buscou — sem uma 2ª chamada à TCBX). Faz upsert por
 * (customer_id, provider, external_id) e remove o que sumiu da fonte: marca
 * todos com o mesmo `synced_at` e apaga os que ficaram com um anterior. Nunca
 * lança; loga e devolve o que deu.
 */
export async function storeExternalContracts(
  supabase: Admin,
  customerId: string,
  contratos: CustomerContract[]
): Promise<{ upserted: number; active: number }> {
  const syncedAt = new Date().toISOString();
  const rows = contratos.map((contract) => ({
    customer_id: customerId,
    provider: PROVIDER,
    external_id: String(contract.id),
    numero: contract.numero,
    modalidade: contract.modalidade,
    status: contract.status,
    status_vigencia: contract.statusVigencia,
    data_inicio: isoDate(contract.dataInicio),
    data_fim: isoDate(contract.dataFim),
    vencimento_dia: billingDay(contract.vencimentoDia),
    data_ativacao: isoDate(contract.dataAtivacao),
    synced_at: syncedAt,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("external_contracts")
      .upsert(rows, { onConflict: "customer_id,provider,external_id" });
    if (error) {
      console.error("storeExternalContracts: upsert", error.code, error.message);
      return { upserted: 0, active: 0 };
    }
  }

  // Apaga os contratos que não vieram nesta leva (ficaram com synced_at antigo).
  const { error: pruneError } = await supabase
    .from("external_contracts")
    .delete()
    .eq("customer_id", customerId)
    .eq("provider", PROVIDER)
    .lt("synced_at", syncedAt);
  if (pruneError) {
    console.error("storeExternalContracts: prune", pruneError.code, pruneError.message);
  }

  const active = rows.filter((row) => isActive(row.status_vigencia, row.status)).length;
  return { upserted: rows.length, active };
}

/** Esvazia o espelho de uma empresa (a fonte não tem mais esse cliente). */
async function clearExternalContracts(supabase: Admin, customerId: string): Promise<void> {
  const { error } = await supabase
    .from("external_contracts")
    .delete()
    .eq("customer_id", customerId)
    .eq("provider", PROVIDER);
  if (error) console.error("clearExternalContracts", error.code, error.message);
}

/**
 * Sincroniza o espelho de UMA empresa: consulta a fonte pelo CNPJ e grava.
 * `not_found` esvazia o espelho (a fonte é a verdade); `unavailable`/`ambiguous`
 * preservam o que já havia (falha transitória não apaga). Nunca lança.
 */
export async function syncExternalContracts(
  supabase: Admin,
  input: { customerId: string; cnpj: string | null }
): Promise<SyncContractsResult> {
  if (!input.cnpj) return { state: "skipped" };

  const result = await getCustomerContext({ documento: input.cnpj });
  switch (result.state) {
    case "not_configured":
      return { state: "not_configured" };
    case "unavailable":
      return { state: "unavailable" };
    case "ambiguous":
      return { state: "ambiguous" };
    case "not_found":
      await clearExternalContracts(supabase, input.customerId);
      return { state: "not_found" };
    case "ok": {
      const stored = await storeExternalContracts(
        supabase,
        input.customerId,
        result.context.contratos
      );
      return { state: "ok", ...stored };
    }
  }
}

const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;

const emptyReport = (): ReconcileContractsReport => ({
  processed: 0,
  ok: 0,
  notFound: 0,
  unavailable: 0,
  ambiguous: 0,
  skipped: 0,
  contractsUpserted: 0,
  cursor: null,
  done: true,
  notConfigured: false,
});

/**
 * Reconciliação em levas: para cada empresa ATIVA com CNPJ (em ordem de id, a
 * partir do cursor), sincroniza o espelho de contratos. Avança por CURSOR (id da
 * empresa), como o cadastro em massa. `not_configured` aborta a leva (a fonte
 * está desligada — seguir é inútil).
 */
export async function reconcileExternalContracts(
  supabase: Admin,
  options: { limit?: number; after?: string | null }
): Promise<ReconcileContractsReport> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_BATCH, 1), MAX_BATCH);
  const report = emptyReport();

  let query = supabase
    .from("customers")
    .select("id, cnpj")
    .not("cnpj", "is", null)
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (options.after) query = query.gt("id", options.after);

  const { data, error } = await query;
  if (error) throw new Error(`customers: ${error.message}`);

  const rows = data ?? [];
  const batch = rows.slice(0, limit);
  report.done = rows.length <= limit;
  report.cursor = batch.length > 0 ? batch[batch.length - 1].id : (options.after ?? null);

  for (const customer of batch) {
    report.processed += 1;
    const result = await syncExternalContracts(supabase, {
      customerId: customer.id,
      cnpj: customer.cnpj,
    });
    report.cursor = customer.id;

    switch (result.state) {
      case "ok":
        report.ok += 1;
        report.contractsUpserted += result.upserted;
        break;
      case "not_found":
        report.notFound += 1;
        break;
      case "unavailable":
        report.unavailable += 1;
        break;
      case "ambiguous":
        report.ambiguous += 1;
        break;
      case "skipped":
        report.skipped += 1;
        break;
      case "not_configured":
        // A fonte está desligada: aborta a leva aqui, sem contar esta empresa
        // (ela entra na próxima quando a fonte voltar).
        report.processed -= 1;
        report.cursor = options.after ?? null;
        report.notConfigured = true;
        report.done = true;
        return report;
    }
  }

  if (report.done) report.cursor = null;
  return report;
}
