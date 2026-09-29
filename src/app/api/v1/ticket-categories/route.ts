import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";
import { toTicketCategory } from "@/lib/api/v1/catalog";
import { apiOk, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// As categorias que um ticket novo pode receber: gerais ou de fila ativa, com
// a mãe também ativa (a mesma regra do "Novo ticket").
export const GET = withApi(
  { route: "/api/v1/ticket-categories", scopes: ["catalog:read"] },
  async ({ requestId }) => {
    const { categories } = await getTicketCatalog();
    if (!categories) return unavailable(requestId, "as categorias");
    return apiOk(categories.map(toTicketCategory));
  }
);
