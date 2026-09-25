import { NextResponse } from "next/server";
import { z } from "zod";

import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();

/**
 * Arquiva, não apaga.
 *
 * `appointments.tipo_ensaio` guarda o NOME em texto: remover a linha do
 * catálogo não pode reescrever o histórico do que já foi atendido.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, message: "Tipo inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("appointment_types")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível remover o tipo de atendimento." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Tipo não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: "Tipo removido da lista." });
}
