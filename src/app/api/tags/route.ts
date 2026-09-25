import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isColorName } from "@/features/leads/schemas/colors";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(30),
  color: z.string().trim().refine(isColorName, "Cor inválida.").default("violet"),
});

export async function GET() {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, tags: [] });
  }
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("tags").select("*").order("name");
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tags: data ?? [] });
}

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
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tags")
    .insert({ name: parsed.data.name, color: parsed.data.color })
    .select("*")
    .single();

  if (error) {
    // 23505 = unique violation (nome já existe)
    if (error.code === "23505") {
      return NextResponse.json({ ok: false, message: "Já existe uma tag com esse nome." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/leads");
  revalidatePath("/app/funil");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, tag: data });
}
