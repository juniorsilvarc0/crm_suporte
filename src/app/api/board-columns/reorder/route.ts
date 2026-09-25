import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  orderedIds: z.array(z.string().regex(UUID_RE, "id inválido")).min(1),
});

// Reordena o funil de forma atômica no cliente: recebe a lista de ids na ordem
// final e grava `position = índice`. Evita o bug de "empurrar" uma coluna sem
// trocar com a vizinha (que gerava posições duplicadas e ordem instável).
export async function POST(request: Request) {
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
    return NextResponse.json(
      { ok: false, message: "Ordem inválida.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();

  // `position` não é único → atualizar em paralelo é seguro (sem colisão de constraint).
  const results = await Promise.all(
    parsed.data.orderedIds.map((id, index) =>
      supabase.from("board_columns").update({ position: index }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ ok: false, message: failed.error.message }, { status: 500 });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app");
  return NextResponse.json({ ok: true });
}
