import { NextResponse } from "next/server";

import { reorderStickiesSchema } from "@/features/home/schemas/note";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Grava a ordem em que o usuário arrumou os post-its.
 *
 * A posição de cada um é o índice dele na lista recebida — o cliente manda o
 * arranjo inteiro, não um "moveu de X para Y". É mais tráfego e muito menos
 * chance de duas telas abertas produzirem uma ordem impossível.
 *
 * ⚠️ Cada `update` filtra por `user_id` da SESSÃO. Um id de outra pessoa no
 * corpo não é erro nem exceção: simplesmente não casa com nenhuma linha e não
 * altera nada.
 */
export async function PUT(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const { data: body } = await readJsonBody(request);
  const parsed = reorderStickiesSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const results = await Promise.all(
    parsed.data.ids.map((id, index) =>
      supabase
        .from("user_notes")
        .update({ position: index })
        .eq("id", id)
        .eq("user_id", auth.viewer.id)
        .eq("kind", "sticky")
    )
  );

  const failed = results.find((result) => result.error);
  if (failed?.error) {
    console.error("PUT /api/notes/reorder", failed.error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível salvar a ordem dos post-its." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
