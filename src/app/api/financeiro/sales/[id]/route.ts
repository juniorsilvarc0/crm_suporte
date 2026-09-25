import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { buildSalePayments } from "@/features/financeiro/lib/build-sale-payments";
import { recomputeContractStatus } from "@/features/financeiro/queries/recompute-contract-status";
import { saleEditSchema } from "@/features/financeiro/schemas/sale";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edita uma venda.
 *
 * Os pagamentos derivam dos valores: mudar total, desconto, entrada ou número
 * de parcelas muda todas as linhas. Por isso a RPC `update_sale` substitui o
 * conjunto inteiro numa transação, em vez de casar linha a linha.
 *
 * Não mexe no funil: o card já foi movido quando a venda entrou.
 */
export async function PATCH(
  request: Request,
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

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = saleEditSchema.safeParse(body.data);
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

  const input = parsed.data;
  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { payments } = buildSalePayments(input, { nowIso });

  const { error } = await supabase.rpc("update_sale", {
    p_contract_id: id,
    p_procedure_name: input.procedure_name,
    p_total_amount: input.total_amount,
    p_discount: input.discount,
    p_notes: input.notes ?? null,
    p_payments: payments,
  });

  if (error) {
    if (error.message.includes("contract_not_found")) {
      return NextResponse.json({ ok: false, message: "Venda não encontrada." }, { status: 404 });
    }
    if (error.message.includes("contract_cancelled")) {
      return NextResponse.json(
        { ok: false, message: "Venda cancelada não pode ser editada." },
        { status: 409 }
      );
    }
    console.error("[sales] update_sale_failed", error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível salvar a venda." },
      { status: 500 }
    );
  }

  await recomputeContractStatus(supabase, id);

  revalidatePath("/app");
  revalidatePath("/app/funil");
  revalidatePath("/app/leads");

  return NextResponse.json({ ok: true, id });
}
