import type { SupabaseClient } from "@supabase/supabase-js";

import type { StoredExternalContract } from "@/features/customers/types";
import type { Database } from "@/lib/supabase/types";

const SELECT =
  "id, external_id, numero, modalidade, status, status_vigencia, data_inicio, data_fim, vencimento_dia, data_ativacao, synced_at";

/**
 * Contratos espelhados da fonte externa (TCBX) de uma empresa, para a ficha.
 * Somente leitura. Resiliente: erro de leitura devolve vazio e loga (padrão de
 * getNotes/getAppUsers) — a ficha abre, o bloco só não lista.
 *
 * Ordem: ativos primeiro ('ativo' < 'encerrado' < 'suspenso' no texto), e dentro
 * disso o mais recente no topo.
 */
export async function getExternalContracts(
  supabase: SupabaseClient<Database>,
  customerId: string
): Promise<StoredExternalContract[]> {
  const { data, error } = await supabase
    .from("external_contracts")
    .select(SELECT)
    .eq("customer_id", customerId)
    .order("status_vigencia", { ascending: true, nullsFirst: false })
    .order("data_inicio", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("getExternalContracts failed", error.code, error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    externalId: row.external_id,
    numero: row.numero,
    modalidade: row.modalidade,
    status: row.status,
    statusVigencia: row.status_vigencia,
    dataInicio: row.data_inicio,
    dataFim: row.data_fim,
    vencimentoDia: row.vencimento_dia,
    dataAtivacao: row.data_ativacao,
    syncedAt: row.synced_at,
  }));
}
