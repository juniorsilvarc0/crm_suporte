import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isColorName } from "@/features/tags/schemas/colors";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  color: z.string().trim().refine(isColorName, "Cor inválida.").optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Tag inválida." }, { status: 400 });
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
    .from("tags")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: false, message: "Já existe uma tag com esse nome." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Tag não encontrada." }, { status: 404 });
  }

  revalidatePath("/app/leads");
  revalidatePath("/app/funil");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, tag: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Tag inválida." }, { status: 400 });
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const supabase = createSupabaseAdminClient();
  // lead_tags tem ON DELETE CASCADE → some das atribuições automaticamente.
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/leads");
  revalidatePath("/app/funil");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, message: "Tag removida." });
}
