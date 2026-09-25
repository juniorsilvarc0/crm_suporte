import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cancela uma venda: `status = 'cancelado'`.
 *
 * O dashboard já ignora contrato cancelado (`fetchContracts` filtra), então a
 * receita, o ticket e o LTV se corrigem sozinhos. Os pagamentos ficam como
 * histórico — `recomputeContractStatus` retorna cedo em cancelado, então nada
 * reabre o contrato depois.
 *
 * NÃO mexe no card do funil. O card foi para a etapa de ganho quando a venda
 * entrou; para onde ele deveria voltar não é derivável, e mover sozinho seria
 * adivinhação. Quem chama avisa isso na tela.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Venda inválida." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contracts")
    .update({ status: "cancelado" })
    .eq("id", id)
    .neq("status", "cancelado")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, message: "Venda não encontrada ou já cancelada." },
      { status: 404 }
    );
  }

  revalidatePath("/app");
  revalidatePath("/app/funil");
  revalidatePath("/app/leads");

  return NextResponse.json({ ok: true, id });
}
