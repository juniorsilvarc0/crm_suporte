import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const schema = z.object({ showStageMeta: z.boolean() });

// Atualiza o toggle global do funil (exibir ou não probabilidade/situação das
// etapas). Guardado em app_settings.key = 'funnel'.
export async function PATCH(request: Request) {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase não configurado." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Valor inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "funnel",
      value: { showStageMeta: parsed.data.showStageMeta },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, showStageMeta: parsed.data.showStageMeta });
}
