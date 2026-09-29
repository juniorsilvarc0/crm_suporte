import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";
import { toSlaPolicy } from "@/lib/api/v1/catalog";
import { apiOk, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prioridades com os prazos de SLA, da menos urgente para a mais: `rank`
// crescente, e maior = mais urgente (baixa=1 … critica=4).
export const GET = withApi({ route: "/api/v1/sla-policies", scopes: ["catalog:read"] }, async ({ requestId }) => {
  const { priorities } = await getTicketCatalog();
  if (!priorities) return unavailable(requestId, "as políticas de SLA");
  return apiOk(priorities.map(toSlaPolicy));
});
