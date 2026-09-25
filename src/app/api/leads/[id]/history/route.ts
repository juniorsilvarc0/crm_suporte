import { NextResponse } from "next/server";

import { buildLeadHistoryItems } from "@/features/leads/lib/lead-history";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireDashboardUser();
  if ("error" in access) return access.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Lead inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const [historyResult, columnsResult] = await Promise.all([
    supabase
      .from("deal_stage_history")
      .select("id, from_stage, to_stage, occurred_at")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: false }),
    supabase.from("board_columns").select("key, label"),
  ]);

  if (historyResult.error || columnsResult.error) {
    console.error(
      "getLeadHistory failed",
      historyResult.error?.message ?? columnsResult.error?.message
    );
    return NextResponse.json(
      { ok: false, message: "Não foi possível carregar o histórico." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    items: buildLeadHistoryItems(historyResult.data ?? [], columnsResult.data ?? []),
  });
}
