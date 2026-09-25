import { getBoardColumns } from "@/features/board/queries/get-board-columns";
import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";

export const runtime = "nodejs";

// GET /api/integracao/board — etapas do funil (na ordem) + nº de cards (deals)
// em cada. É a "visão do quadro": o agente vê as colunas e quantos cards há.
// Os cards do funil são DEALS (N por lead), então um cliente recorrente conta
// como vários cards. Deals de leads importados (histórico) são ignorados.
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;

  const columns = await getBoardColumns();
  const { data: deals, error } = await auth.supabase
    .from("deals")
    .select("stage, lead:leads(imported, archived_at)")
    .is("removed_at", null);
  if (error) return fail(error.message, 500);

  const visible = (deals ?? []).filter(
    (d) => {
      const lead = d.lead as {
        imported: boolean | null;
        archived_at: string | null;
      } | null;
      return !lead?.imported && !lead?.archived_at;
    }
  );

  const counts = new Map<string, number>();
  for (const d of visible) counts.set(d.stage, (counts.get(d.stage) ?? 0) + 1);

  const stages = columns.map((c) => ({
    key: c.key,
    label: c.label,
    color: c.color,
    position: c.position,
    stage_type: c.stage_type,
    probability: c.probability,
    deals: counts.get(c.key) ?? 0,
  }));

  return ok({ stages, totalDeals: visible.length });
}
