import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();

type Params = { params: Promise<{ id: string }> };

/**
 * Exclui o bloqueio de verdade: nada aponta para ele (diferente de um
 * compromisso, que vira histórico). Mudar = excluir e cadastrar de novo.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const idResult = idSchema.safeParse((await params).id);
  if (!idResult.success) {
    return NextResponse.json({ ok: false, message: "Bloqueio inválido." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agenda_blocks")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[DELETE /api/agenda-blocks/[id]]", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível excluir o bloqueio." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Bloqueio não encontrado." }, { status: 404 });
  }

  revalidatePath("/app/agendamentos");
  return NextResponse.json({ ok: true });
}
