import { NextResponse } from "next/server";

import { updateStickySchema } from "@/features/home/schemas/note";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

// Editar e excluir post-it. O filtro por `user_id` da sessão é a fronteira: sem
// ele, um id vazado editaria a nota de outra pessoa.
export async function PATCH(request: Request, context: Context) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const { id } = await context.params;
  const { data: body } = await readJsonBody(request);
  const parsed = updateStickySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 }
    );
  }

  const patch: Database["public"]["Tables"]["user_notes"]["Update"] = {};
  if (parsed.data.content !== undefined) patch.content = parsed.data.content;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  if (parsed.data.title !== undefined) patch.title = parsed.data.title || null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Nada para alterar." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("user_notes")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.viewer.id)
    .eq("kind", "sticky")
    .select("id, title, content, color, updated_at")
    .maybeSingle();

  if (error) {
    console.error("PATCH /api/notes/[id]", error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar o post-it." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Post-it não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, note: data });
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("user_notes")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.viewer.id)
    .eq("kind", "sticky");

  if (error) {
    console.error("DELETE /api/notes/[id]", error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível excluir o post-it." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
