import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

export async function recomputeContractStatus(
  supabase: SupabaseClient<Database>,
  contractId: string,
) {
  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id, total_amount, discount, status")
    .eq("id", contractId)
    .maybeSingle();

  if (contractError) throw contractError;
  if (!contract || contract.status === "cancelado") return;

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select("amount")
    .eq("contract_id", contractId)
    .eq("status", "pago");

  if (paymentsError) throw paymentsError;

  const paid = (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const netAmount = Math.max(0, Number(contract.total_amount) - Number(contract.discount ?? 0));
  // Compara em centavos (inteiros) para evitar erro de ponto flutuante: um
  // contrato pago em parcelas somava 99.999... e era marcado como "aberto".
  const nextStatus =
    Math.round(paid * 100) >= Math.round(netAmount * 100) ? "quitado" : "aberto";

  if (nextStatus !== contract.status) {
    const { error } = await supabase
      .from("contracts")
      .update({ status: nextStatus })
      .eq("id", contractId);

    if (error) throw error;
  }
}
