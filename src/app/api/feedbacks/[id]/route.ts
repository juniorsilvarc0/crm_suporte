import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

const FEEDBACK_BUCKET = "feedback-screenshots";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: feedback, error: existingError } = await supabase
    .from("feedback_requests")
    .select("image_url")
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

  if (feedback.image_url) {
    const { error: storageError } = await supabase.storage
      .from(FEEDBACK_BUCKET)
      .remove([feedback.image_url]);

    if (storageError) {
      return NextResponse.json({ ok: false, message: storageError.message }, { status: 500 });
    }
  }

  const { error: deleteError } = await supabase
    .from("feedback_requests")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ ok: false, message: deleteError.message }, { status: 500 });
  }

  revalidatePath("/app/feedbacks");

  return NextResponse.json({ ok: true, message: "Feedback excluído." });
}
