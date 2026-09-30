import { CONTRACT_SELECT, toContractView, type ContractRowFromDb } from "@/features/contracts/lib/contract-view";
import { toApiContract } from "@/lib/api/v1/cadastros";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O contrato ATUAL da empresa, sem valor nem dia de vencimento: o vigente
 * (ativo ou suspenso, no máximo um pelo índice único), senão o último
 * encerrado. É a regra do selo (`sync_customer_contract_status`), então
 * `data.status` bate com o `contract_status` da empresa. `data: null` = a
 * empresa nunca teve contrato.
 *
 * Os contratos vêm numa consulta só (um snapshot): vigente e encerrado lidos
 * em separado, uma troca de status entre as duas leituras daria `null`
 * ("nunca teve") a quem sempre teve.
 */
export const GET = withApi<{ id: string }>(
  { route: "/api/v1/customers/[id]/contract", scopes: ["customers:read"] },
  async ({ params, requestId, supabase }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Empresa não encontrada.");

    const [customerRes, contractsRes] = await Promise.all([
      supabase.from("customers").select("id").eq("id", params.id).maybeSingle(),
      // A ordem do selo para os encerrados; o vigente é escolhido abaixo.
      supabase
        .from("support_contracts")
        .select(CONTRACT_SELECT)
        .eq("customer_id", params.id)
        .order("ends_on", { ascending: false, nullsFirst: true })
        .order("created_at", { ascending: false }),
    ]);

    const failed = customerRes.error ?? contractsRes.error;
    if (failed) {
      console.error(`[api/v1] ${requestId} contract`, failed.message);
      return unavailable(requestId, "o contrato");
    }
    if (!customerRes.data) return notFound(requestId, "Empresa não encontrada.");

    const rows: ContractRowFromDb[] = contractsRes.data ?? [];
    const row = rows.find((contract) => contract.status !== "encerrado") ?? rows[0];
    if (!row) return apiOk(null);
    const view = toContractView(row);
    // Situação fora do check do banco: falha em vez de dizer "sem contrato".
    if (!view) {
      console.error(`[api/v1] ${requestId} contract: situação inesperada`, row.id);
      return unavailable(requestId, "o contrato");
    }
    return apiOk(toApiContract(view));
  }
);
