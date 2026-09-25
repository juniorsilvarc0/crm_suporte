import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Catálogo mantido pelo usuário, no mesmo formato de /api/tags e
// /api/board-columns. A sessão vem do proxy (matcher cobre /api/:path*).
const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do procedimento.")
    .max(120, "No máximo 120 caracteres."),
  default_amount: z.coerce
    .number()
    .positive("O valor precisa ser maior que zero.")
    .nullish(),
});

export async function GET() {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, procedures: [] });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("procedures")
    .select("id, name, default_amount")
    .is("archived_at", null)
    .order("name");

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, procedures: data ?? [] });
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
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("procedures")
    .insert({
      name: parsed.data.name,
      default_amount: parsed.data.default_amount ?? null,
    })
    .select("id, name, default_amount")
    .single();

  if (error) {
    // 23505 = unique violation. O índice é parcial em lower(btrim(name)) para
    // archived_at is null, então isso só acontece com um ATIVO de mesmo nome.
    // O cliente trata 409 selecionando o existente — é corrida entre abas, não
    // erro do usuário.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("procedures")
        .select("id, name, default_amount")
        .is("archived_at", null)
        .ilike("name", parsed.data.name)
        .maybeSingle();

      return NextResponse.json(
        {
          ok: false,
          message: "Esse procedimento já existe.",
          procedure: existing ?? null,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/leads");
  return NextResponse.json({ ok: true, procedure: data });
}
