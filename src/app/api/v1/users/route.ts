import { getAssignableUsers } from "@/features/tickets/queries/get-assignable-users";
import { toAssignableUsers } from "@/lib/api/v1/catalog";
import { apiOk, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quem pode receber ticket (ativos), por nome. Sem e-mail nem papel.
export const GET = withApi({ route: "/api/v1/users", scopes: ["catalog:read"] }, async ({ requestId }) => {
  const team = await getAssignableUsers();
  if (!team) return unavailable(requestId, "a equipe");
  return apiOk(toAssignableUsers(team));
});
