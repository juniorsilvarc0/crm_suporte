import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";
import { toTicketStatuses } from "@/lib/api/v1/catalog";
import { apiOk, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status na ordem do quadro, com os destinos permitidos de cada um: é por aqui
// que a IA sabe o que pode pedir em /tickets/{id}/transitions.
export const GET = withApi(
  { route: "/api/v1/ticket-statuses", scopes: ["catalog:read"] },
  async ({ requestId }) => {
    const { statuses, transitions } = await getTicketCatalog();
    if (!statuses || !transitions) return unavailable(requestId, "os status");
    return apiOk(toTicketStatuses(statuses, transitions));
  }
);
