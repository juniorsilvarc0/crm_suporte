import { NextResponse } from "next/server";
import { z } from "zod";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();

/**
 * Bloqueio é apagado de verdade, diferente de unidade e tipo de atendimento.
 *
 * Aqueles são referenciados por agendamentos já gravados e precisam sobreviver
 * como histórico. Um bloqueio não é referenciado por nada: ele só existe para
 * dizer "não marque aqui". Desfazer é simplesmente deixar de dizer isso.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, message: "Bloqueio inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agenda_blocks")
    .delete()
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível remover o bloqueio." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Bloqueio não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: "Bloqueio removido." });
}
