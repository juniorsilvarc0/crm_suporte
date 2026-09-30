import { CUSTOMER_API_SELECT, toApiCustomer } from "@/lib/api/v1/cadastros";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uma empresa, arquivada inclusive (o histórico continua existindo). */
export const GET = withApi<{ id: string }>(
  { route: "/api/v1/customers/[id]", scopes: ["customers:read"] },
  async ({ params, requestId, supabase }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Empresa não encontrada.");

    const { data, error } = await supabase
      .from("customers")
      .select(CUSTOMER_API_SELECT)
      .eq("id", params.id)
      .maybeSingle();
    if (error) {
      console.error(`[api/v1] ${requestId} customer`, error.message);
      return unavailable(requestId, "a empresa");
    }
    if (!data) return notFound(requestId, "Empresa não encontrada.");
    return apiOk(toApiCustomer(data));
  }
);
