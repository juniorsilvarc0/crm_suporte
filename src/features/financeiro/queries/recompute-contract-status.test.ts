import { describe, expect, it } from "vitest";

import { recomputeContractStatus } from "@/features/financeiro/queries/recompute-contract-status";

type Row = Record<string, unknown>;

// Mock mínimo do client Supabase que atende as chamadas da função:
//   contracts.select().eq().maybeSingle(), payments.select().eq().eq(),
//   contracts.update().eq().
function makeClient(contract: Row | null, payments: Row[]) {
  let updatedStatus: string | undefined;
  const client = {
    from(table: string) {
      if (table === "contracts") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: contract, error: null }) }),
          }),
          update: (patch: Row) => ({
            eq: async () => {
              updatedStatus = patch.status as string;
              return { error: null };
            },
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: async () => ({ data: payments, error: null }) }) }),
      };
    },
  };
  return { client: client as never, updated: () => updatedStatus };
}

describe("recomputeContractStatus", () => {
  it("marca quitado quando as parcelas somam o total apesar do float (R$100 em 7 parcelas)", async () => {
    const { client, updated } = makeClient(
      { id: "c1", total_amount: 100, discount: 0, status: "aberto" },
      [14.29, 14.29, 14.29, 14.29, 14.29, 14.29, 14.26].map((amount) => ({ amount })),
    );
    await recomputeContractStatus(client, "c1");
    expect(updated()).toBe("quitado");
  });

  it("não atualiza quando ainda falta pagamento (segue aberto)", async () => {
    const { client, updated } = makeClient(
      { id: "c1", total_amount: 100, discount: 0, status: "aberto" },
      [{ amount: 50 }],
    );
    await recomputeContractStatus(client, "c1");
    expect(updated()).toBeUndefined();
  });

  it("considera o desconto (netAmount) ao quitar", async () => {
    const { client, updated } = makeClient(
      { id: "c1", total_amount: 100, discount: 100, status: "aberto" },
      [],
    );
    await recomputeContractStatus(client, "c1");
    expect(updated()).toBe("quitado");
  });

  it("não mexe em contrato cancelado", async () => {
    const { client, updated } = makeClient(
      { id: "c1", total_amount: 100, discount: 0, status: "cancelado" },
      [{ amount: 100 }],
    );
    await recomputeContractStatus(client, "c1");
    expect(updated()).toBeUndefined();
  });
});
