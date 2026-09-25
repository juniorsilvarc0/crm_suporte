import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isColorName } from "@/features/leads/schemas/colors";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const createSchema = z.object({
  label: z.string().trim().min(1, "Informe o nome.").max(40),
  color: z.string().trim().refine(isColorName, "Cor inválida.").default("slate"),
  probability: z.coerce.number().int().min(0).max(100).nullable().default(null),
  stage_type: z.enum(["open", "won", "lost"]).default("open"),
  // Independente de stage_type: uma etapa aberta como "Compareceu" pode contar.
  counts_as_conversion: z.boolean().default(false),
});

export async function GET() {
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: true, columns: [] });
  }
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("board_columns")
    .select("*")
    .order("position", { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, columns: data ?? [] });
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

  // key única a partir do label.
  const base = slugify(parsed.data.label) || "coluna";
  const { data: existing } = await supabase.from("board_columns").select("key");
  const keys = new Set((existing ?? []).map((c: { key: string }) => c.key));
  let key = base;
  let n = 2;
  while (keys.has(key)) key = `${base}-${n++}`;

  // position no fim.
  const { data: last } = await supabase
    .from("board_columns")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (last?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("board_columns")
    .insert({
      key,
      label: parsed.data.label,
      color: parsed.data.color,
      position,
      probability: parsed.data.probability,
      stage_type: parsed.data.stage_type,
      counts_as_conversion: parsed.data.counts_as_conversion,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, column: data });
}
