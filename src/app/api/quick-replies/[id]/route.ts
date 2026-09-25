import { NextResponse } from "next/server";
import { z } from "zod";

import { quickReplyUpdateSchema } from "@/features/quick-replies/schemas";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();
const QUICK_REPLY_COLUMNS =
  "id, title, shortcut, content, is_active, created_by_user_id, created_at, updated_at";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireDashboardUser();
  if ("error" in guard) return guard.error;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, message: "Resposta rápida inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 },
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = quickReplyUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("chat_quick_replies")
    .update(parsed.data)
    .eq("id", parsedId.data)
    .select(QUICK_REPLY_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error.code === "23505"
            ? "Esse atalho já está em uso."
            : "Não foi possível atualizar a resposta rápida.",
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Resposta rápida não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: data, message: "Resposta rápida atualizada." });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireDashboardUser();
  if ("error" in guard) return guard.error;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, message: "Resposta rápida inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("chat_quick_replies")
    .delete()
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível excluir a resposta rápida." },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Resposta rápida não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: "Resposta rápida excluída." });
}
