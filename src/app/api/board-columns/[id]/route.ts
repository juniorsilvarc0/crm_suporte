import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isColorName } from "@/features/leads/schemas/colors";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  color: z.string().trim().refine(isColorName, "Cor inválida.").optional(),
  position: z.coerce.number().int().min(0).optional(),
  probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
  stage_type: z.enum(["open", "won", "lost"]).optional(),
  counts_as_conversion: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Coluna inválida." }, { status: 400 });
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ ok: false, message: "Nada para atualizar." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("board_columns")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Coluna não encontrada." }, { status: 404 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, column: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Coluna inválida." }, { status: 400 });
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: target, error: getErr } = await supabase
    .from("board_columns")
    .select("id, key")
    .eq("id", id)
    .maybeSingle();
  if (getErr) {
    return NextResponse.json({ ok: false, message: getErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ ok: false, message: "Coluna não encontrada." }, { status: 404 });
  }
  if (target.key === "novo") {
    return NextResponse.json(
      { ok: false, message: "Não é possível excluir a coluna de entrada padrão." },
      { status: 409 }
    );
  }

  // O BEFORE DELETE do banco move cards ativos e suas projeções para `novo`
  // dentro da mesma transação da exclusão. Se falhar, nada fica pela metade.
  const { error: delErr } = await supabase.from("board_columns").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ ok: false, message: delErr.message }, { status: 500 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/leads");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, message: "Categoria removida.", movedTo: "novo" });
}
