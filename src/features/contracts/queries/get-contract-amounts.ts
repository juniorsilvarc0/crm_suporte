import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

/**
 * Valor mensal dos contratos de uma empresa, por id de contrato. É a ÚNICA
 * leitura de monthly_amount: o service_role não lê a coluna, e a RPC confere
 * no banco que o ator é admin ATIVO. Só a ficha da empresa, para admin, chama.
 *
 * `null` = valor indisponível (erro, ou quem pediu deixou de ser admin): a tela
 * mostra "Valor indisponível", nunca R$ 0. Map vazio = empresa sem contratos.
 */
export async function getContractAmounts(
  actorId: string,
  customerId: string
): Promise<Map<string, number> | null> {
  if (!hasSupabaseAdminEnv()) return null;

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("get_support_contract_amounts", {
      p_actor_id: actorId,
      p_customer_id: customerId,
    });
    if (error) {
      console.error("getContractAmounts failed", error.message);
      return null;
    }
    // Valor que não vira número finito fica fora do Map: aquele contrato cai
    // em "Valor indisponível" em vez de mostrar NaN.
    const amounts = new Map<string, number>();
    for (const row of data ?? []) {
      const amount = Number(row.monthly_amount);
      if (Number.isFinite(amount)) amounts.set(row.contract_id, amount);
    }
    return amounts;
  } catch (error) {
    console.error("getContractAmounts threw", error);
    return null;
  }
}
