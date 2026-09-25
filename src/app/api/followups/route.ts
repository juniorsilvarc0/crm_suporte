import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createFollowupSchema } from "@/features/followups/schemas/actions";
import { localDateTimeToIso } from "@/lib/formatters/date";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = createFollowupSchema.safeParse(body.data);
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

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("followups")
    .insert({
      lead_id: parsed.data.lead_id,
      scheduled_for: localDateTimeToIso(parsed.data.scheduled_for),
      message: parsed.data.message ?? null,
      status: "pendente",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/follow-ups");
  return NextResponse.json({ ok: true, message: "Follow-up criado." });
}
