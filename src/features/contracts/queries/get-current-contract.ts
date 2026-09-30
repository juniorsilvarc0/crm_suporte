import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTRACT_SELECT, toContractView, type ContractRowFromDb } from "@/features/contracts/lib/contract-view";
import type { ContractView } from "@/features/contracts/types";
import type { Database } from "@/lib/supabase/types";

/**
 * O contrato ATUAL da empresa, sem valor nem dia de vencimento: o vigente
 * (ativo ou suspenso, no máximo um pelo índice único), senão o último
 * encerrado. É a regra do selo (`sync_customer_contract_status`), então o
 * status bate com o `contract_status` da empresa. `null` = nunca teve contrato.
 *
 * Os contratos vêm numa consulta só (um snapshot): vigente e encerrado lidos
 * em separado, uma troca de status entre as duas leituras daria `null`
 * ("nunca teve") a quem sempre teve.
 *
 * LANÇA em erro de leitura e em situação fora do check do banco: quem chama
 * responde "indisponível", nunca "sem contrato".
 */
export async function getCurrentContract(
  supabase: SupabaseClient<Database>,
  customerId: string
): Promise<ContractView | null> {
  const { data, error } = await supabase
    .from("support_contracts")
    .select(CONTRACT_SELECT)
    .eq("customer_id", customerId)
    // A ordem do selo para os encerrados; o vigente é escolhido abaixo.
    .order("ends_on", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`support_contracts: ${error.message}`);

  const rows: ContractRowFromDb[] = data ?? [];
  const row = rows.find((contract) => contract.status !== "encerrado") ?? rows[0];
  if (!row) return null;
  const view = toContractView(row);
  if (!view) throw new Error(`support_contracts: situação inesperada no contrato ${row.id}`);
  return view;
}
