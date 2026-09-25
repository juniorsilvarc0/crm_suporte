import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ARQUIVA o procedimento — não apaga.
 *
 * A venda guarda o nome do procedimento como texto, então o histórico não
 * depende desta linha. Arquivar mantém a possibilidade de desfazer e libera o
 * nome para ser recriado (o índice único é parcial em `archived_at is null`).
 * Apagar de verdade seria a única operação irreversível do fluxo de venda.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Procedimento inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("procedures")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, message: "Procedimento não encontrado." },
      { status: 404 }
    );
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/leads");
  return NextResponse.json({ ok: true, message: "Procedimento removido da lista." });
}
