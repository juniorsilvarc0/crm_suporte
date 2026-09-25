import { fromCents, netAmountCents, toCents } from "@/features/financeiro/lib/money";
import type { SaleEditInput } from "@/features/financeiro/schemas/sale";

// Linhas de `payments` de uma venda. É o que a RPC recebe como jsonb — SQL não
// faz conta de dinheiro nenhuma.
export type SalePaymentRow = {
  amount: number;
  method: string | null;
  installments: number;
  is_signal: boolean;
  status: "pago" | "pendente";
  due_at: string | null;
  paid_at: string | null;
};

export type SalePaymentsResult = {
  payments: SalePaymentRow[];
  netAmount: number;
};

/**
 * Uma venda = um pagamento `pago` com o valor líquido.
 *
 * A venda é sempre recebida no ato; parcelamento no cartão é acordo entre o
 * paciente e o banco, não um saldo a receber da clínica. A função existe
 * mesmo assim porque a conta em centavos (desconto, arredondamento) precisa
 * ficar num lugar testável, fora da rota e fora do SQL.
 */
export function buildSalePayments(
  input: SaleEditInput,
  options: { nowIso: string }
): SalePaymentsResult {
  const netCents = netAmountCents(
    toCents(input.total_amount),
    toCents(input.discount)
  );

  if (netCents === 0) {
    return { payments: [], netAmount: 0 };
  }

  return {
    payments: [
      {
        amount: fromCents(netCents),
        method: input.method,
        installments: 1,
        is_signal: false,
        status: "pago",
        due_at: null,
        paid_at: options.nowIso,
      },
    ],
    netAmount: fromCents(netCents),
  };
}
