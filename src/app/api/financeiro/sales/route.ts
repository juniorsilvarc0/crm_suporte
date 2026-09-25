import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { buildSalePayments } from "@/features/financeiro/lib/build-sale-payments";
import { resolveSaleDeal } from "@/features/financeiro/queries/resolve-sale-deal";
import { resolveWonStage } from "@/features/financeiro/queries/resolve-won-stage";
import { recomputeContractStatus } from "@/features/financeiro/queries/recompute-contract-status";
import { saleSchema } from "@/features/financeiro/schemas/sale";
import { shouldStampClienteAt } from "@/features/leads/lib/status-timestamp";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Registra uma venda.
 *
 * Substitui POST /api/financeiro/contracts, que gravava contrato, pagamentos,
 * lead e deal em chamadas separadas: uma falha no meio deixava contrato órfão
 * que o dashboard já contava como receita cheia. Aqui a escrita inteira vai
 * numa RPC (`register_sale`), e a idempotência mata duplo-clique e retry.
 *
 * O dinheiro é calculado aqui em centavos inteiros (features/financeiro/lib) e
 * desce pronto para o SQL — o banco não faz conta.
 */
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

  const parsed = saleSchema.safeParse(body.data);
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

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", input.lead_id)
    .maybeSingle();
  if (leadError) {
    return NextResponse.json({ ok: false, message: leadError.message }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ ok: false, message: "Cliente não encontrado." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { payments } = buildSalePayments(input, { nowIso });

  // Sem etapa de ganho configurada no board, a venda é registrada assim mesmo e
  // o card fica onde está — quem chama recebe `moved: false` e avisa na tela.
  const wonStage = input.move_to_won ? await resolveWonStage(supabase) : null;

  // Quem registra pelo funil manda o card; quem registra pela lista de leads
  // não tem um. Resolver aqui mantém as duas telas com o mesmo resultado —
  // `register_sale` só move o funil quando recebe `p_deal_id`.
  //
  // Só vale a busca quando há etapa de destino: `contracts` não guarda
  // `deal_id`, então sem `p_stage_key` o card não seria usado para nada.
  const dealId =
    input.deal_id ?? (wonStage ? await resolveSaleDeal(supabase, input.lead_id) : null);

  const { data, error } = await supabase.rpc("register_sale", {
    p_idempotency_key: input.idempotency_key,
    p_lead_id: input.lead_id,
    p_deal_id: dealId,
    p_procedure_name: input.procedure_name,
    p_total_amount: input.total_amount,
    p_discount: input.discount,
    p_notes: input.notes ?? null,
    p_payments: payments,
    p_stage_key: wonStage,
    p_stamp_cliente_at: shouldStampClienteAt(wonStage),
  });

  if (error) {
    console.error("[sales] register_sale_failed", error.message);
    return NextResponse.json(
      { ok: false, message: "Não foi possível registrar a venda." },
      { status: 500 }
    );
  }

  const result = data as {
    contractId: string;
    status: "aberto" | "quitado" | "cancelado";
    moved: boolean;
    alreadyRegistered: boolean;
  };

  // Fora da RPC de propósito: a regra de quitação compara em centavos inteiros
  // e já é a única fonte da verdade, com testes. Duplicá-la em PL/pgSQL criaria
  // dois donos para a mesma decisão.
  if (!result.alreadyRegistered) {
    await recomputeContractStatus(supabase, result.contractId);
  }

  revalidatePath("/app");
  revalidatePath("/app/funil");
  revalidatePath("/app/leads");

  return NextResponse.json({
    ok: true,
    id: result.contractId,
    moved: result.moved,
    alreadyRegistered: result.alreadyRegistered,
  });
}
