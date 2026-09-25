import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { updateFollowupSchema } from "@/features/followups/schemas/actions";
import { localDateTimeToIso } from "@/lib/formatters/date";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const { id } = await params;
  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = updateFollowupSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const update: Database["public"]["Tables"]["followups"]["Update"] = {};
  if (parsed.data.scheduled_for !== undefined) {
    update.scheduled_for = localDateTimeToIso(parsed.data.scheduled_for);
  }
  if (parsed.data.message !== undefined) update.message = parsed.data.message;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("followups")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Follow-up não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/follow-ups");
  return NextResponse.json({ ok: true, message: "Follow-up atualizado." });
}
