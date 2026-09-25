import { describe, expect, it } from "vitest";

import { buildSalePayments } from "@/features/financeiro/lib/build-sale-payments";
import type { SaleEditInput } from "@/features/financeiro/schemas/sale";

const NOW = "2026-08-07T12:00:00.000Z";

function input(overrides: Partial<SaleEditInput> = {}): SaleEditInput {
  return {
    procedure_name: "Rezum",
    total_amount: 1800,
    discount: 0,
    method: "pix",
    ...overrides,
  } as SaleEditInput;
}

describe("buildSalePayments", () => {
  it("gera um pagamento pago com o valor líquido", () => {
    const result = buildSalePayments(input(), { nowIso: NOW });

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toEqual({
      amount: 1800,
      method: "pix",
      installments: 1,
      is_signal: false,
      status: "pago",
      due_at: null,
      paid_at: NOW,
    });
    expect(result.netAmount).toBe(1800);
  });

  it("desconta antes de cobrar", () => {
    const result = buildSalePayments(
      input({ total_amount: 1850.5, discount: 50.5 }),
      { nowIso: NOW }
    );

    expect(result.netAmount).toBe(1800);
    expect(result.payments[0].amount).toBe(1800);
  });

  it("preserva os centavos", () => {
    const result = buildSalePayments(
      input({ total_amount: 1234.56, discount: 0.06 }),
      { nowIso: NOW }
    );

    expect(result.payments[0].amount).toBe(1234.5);
  });

  it("respeita a forma de pagamento escolhida", () => {
    const result = buildSalePayments(input({ method: "credito" }), { nowIso: NOW });
    expect(result.payments[0].method).toBe("credito");
  });

  it("líquido zero não gera pagamento nenhum", () => {
    const result = buildSalePayments(
      input({ total_amount: 100, discount: 100 }),
      { nowIso: NOW }
    );

    expect(result.payments).toEqual([]);
    expect(result.netAmount).toBe(0);
  });

  it("desconto maior que o total não vira valor negativo", () => {
    // O schema barra isso antes; aqui garantimos que a função não inventa
    // um pagamento negativo se chegar assim mesmo.
    const result = buildSalePayments(
      input({ total_amount: 100, discount: 500 }),
      { nowIso: NOW }
    );

    expect(result.payments).toEqual([]);
    expect(result.netAmount).toBe(0);
  });
});
