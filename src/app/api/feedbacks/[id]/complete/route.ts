import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data: feedback, error: existingError } = await supabase
    .from("feedback_requests")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ ok: false, message: existingError.message }, { status: 500 });
  }

  if (!feedback) {
    return NextResponse.json(
      { ok: false, message: "Feedback não encontrado." },
      { status: 404 }
    );
  }

  if (feedback.status === "done") {
    return NextResponse.json({ ok: true, message: "Feedback já concluído." });
  }

  const { error: updateError } = await supabase
    .from("feedback_requests")
    .update({ status: "done", resolved_at: now })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ ok: false, message: updateError.message }, { status: 500 });
  }

  revalidatePath("/app/feedbacks");

  return NextResponse.json({ ok: true, message: "Feedback concluído." });
}
