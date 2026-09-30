import { getCurrentContract } from "@/features/contracts/queries/get-current-contract";
import { toApiContract } from "@/lib/api/v1/cadastros";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O contrato atual da empresa, sem valor nem dia de vencimento (a regra do
 * selo, em getCurrentContract). `data: null` = a empresa nunca teve contrato.
 */
export const GET = withApi<{ id: string }>(
  { route: "/api/v1/customers/[id]/contract", scopes: ["customers:read"] },
  async ({ params, requestId, supabase }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Empresa não encontrada.");

    const [customerRes, contractRes] = await Promise.all([
      supabase.from("customers").select("id").eq("id", params.id).maybeSingle(),
      getCurrentContract(supabase, params.id).then(
        (contract) => ({ contract }),
        (error: unknown) => ({ error })
      ),
    ]);

    if (customerRes.error || "error" in contractRes) {
      console.error(
        `[api/v1] ${requestId} contract`,
        customerRes.error?.message ?? ("error" in contractRes ? contractRes.error : "")
      );
      return unavailable(requestId, "o contrato");
    }
    if (!customerRes.data) return notFound(requestId, "Empresa não encontrada.");
    return apiOk(contractRes.contract ? toApiContract(contractRes.contract) : null);
  }
);
