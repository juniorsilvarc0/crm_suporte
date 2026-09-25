import { getDashboardData } from "@/features/dashboard/queries/get-dashboard-data";
import {
  authorizeIntegration,
  ok,
} from "@/features/integrations/lib/authorize-integration";

export const runtime = "nodejs";

// GET /api/integracao/metrics?period=7d|30d|90d|all — todas as métricas do
// dashboard em JSON (KPIs, funil, "onde estão", LTV/recompra, por origem/estado…).
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;

  const period = new URL(request.url).searchParams.get("period") ?? "all";
  const data = await getDashboardData(period);

  return ok({ dashboard: data });
}
