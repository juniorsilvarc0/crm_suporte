import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardTracking } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardTracking();
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("retry_meta_conversion_outbox", {
    p_id: id,
  });
  if (error) {
    return NextResponse.json({ ok: false, reason: "retry_failed" }, { status: 500 });
  }
  if (data === "not_found") {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  if (data === "conflict" || data === "ineligible") {
    return NextResponse.json({ ok: false, reason: data }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: "requeued" }, { status: 202 });
}
