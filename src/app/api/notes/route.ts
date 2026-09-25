import { NextResponse } from "next/server";

import { createStickySchema, quickNoteSchema } from "@/features/home/schemas/note";
import { getNotes } from "@/features/home/queries/get-notes";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Notas do bloco "Minhas notas" da tela de Início. Cada usuário só enxerga e
// altera as PRÓPRIAS notas: o `user_id` vem sempre da sessão, nunca do corpo.
export async function GET() {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  return NextResponse.json({ ok: true, ...(await getNotes(auth.viewer.id)) });
}

/** Cria um post-it. */
export async function POST(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const { data: body } = await readJsonBody(request);
  const parsed = createStickySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();

  // O post-it novo entra NA FRENTE dos outros: é onde a pessoa acabou de olhar.
  // Uma posição abaixo da menor existente consegue isso sem reescrever a ordem
  // que o usuário arrumou à mão.
  const { data: firstNote } = await supabase
    .from("user_notes")
    .select("position")
    .eq("user_id", auth.viewer.id)
    .eq("kind", "sticky")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const position = ((firstNote?.position as number | null) ?? 0) - 1;

  const { data, error } = await supabase
    .from("user_notes")
    .insert({
      user_id: auth.viewer.id,
      kind: "sticky",
      title: parsed.data.title || null,
      content: parsed.data.content,
      color: parsed.data.color,
      position,
    })
    .select("id, title, content, color, updated_at")
    .single();

  if (error) {
    console.error("POST /api/notes", error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar o post-it." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, note: data }, { status: 201 });
}

/** Grava o lembrete rápido — um por usuário, criado na primeira escrita. */
export async function PUT(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const { data: body } = await readJsonBody(request);
  const parsed = quickNoteSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  // `onConflict` no índice parcial de `kind = 'quick'` não é alcançável pelo
  // upsert do supabase-js; então é update-e-insere-se-não-existir.
  const { data: updated, error: updateError } = await supabase
    .from("user_notes")
    .update({ content: parsed.data.content })
    .eq("user_id", auth.viewer.id)
    .eq("kind", "quick")
    .select("updated_at")
    .maybeSingle();

  if (updateError) {
    console.error("PUT /api/notes", updateError.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar o lembrete." }, { status: 500 });
  }

  if (updated) return NextResponse.json({ ok: true, updatedAt: updated.updated_at });

  const { data: inserted, error: insertError } = await supabase
    .from("user_notes")
    .insert({ user_id: auth.viewer.id, kind: "quick", content: parsed.data.content })
    .select("updated_at")
    .single();

  if (insertError) {
    console.error("PUT /api/notes:insert", insertError.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar o lembrete." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updatedAt: inserted.updated_at }, { status: 201 });
}
