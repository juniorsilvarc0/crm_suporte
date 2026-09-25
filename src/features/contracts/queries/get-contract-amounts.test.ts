import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

import { getContractAmounts } from "@/features/contracts/queries/get-contract-amounts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const CONTRACT_A = "33333333-3333-4333-8333-333333333333";
const CONTRACT_B = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getContractAmounts", () => {
  it("chama a RPC com o ator e a empresa e devolve o valor por contrato", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { contract_id: CONTRACT_A, monthly_amount: 1500 },
        { contract_id: CONTRACT_B, monthly_amount: 0 },
      ],
      error: null,
    });

    const amounts = await getContractAmounts(ACTOR_ID, CUSTOMER_ID);

    expect(rpcMock).toHaveBeenCalledWith("get_support_contract_amounts", {
      p_actor_id: ACTOR_ID,
      p_customer_id: CUSTOMER_ID,
    });
    expect(amounts).toEqual(
      new Map([
        [CONTRACT_A, 1500],
        [CONTRACT_B, 0],
      ])
    );
  });

  it("devolve Map vazio para empresa sem contratos, e não null", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    expect(await getContractAmounts(ACTOR_ID, CUSTOMER_ID)).toEqual(new Map());
  });

  it("devolve null e loga quando a RPC recusa (ex.: ator deixou de ser admin)", async () => {
    // null vira "Valor indisponível" na tela; um Map vazio viraria contratos
    // sem valor, e R$ 0 seria um número inventado.
    rpcMock.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });

    expect(await getContractAmounts(ACTOR_ID, CUSTOMER_ID)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("devolve null quando o client lança", async () => {
    rpcMock.mockRejectedValue(new Error("rede fora"));

    expect(await getContractAmounts(ACTOR_ID, CUSTOMER_ID)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("deixa fora do Map o valor que não vira número finito", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { contract_id: CONTRACT_A, monthly_amount: "1500.50" },
        { contract_id: CONTRACT_B, monthly_amount: "abc" },
      ],
      error: null,
    });

    expect(await getContractAmounts(ACTOR_ID, CUSTOMER_ID)).toEqual(new Map([[CONTRACT_A, 1500.5]]));
  });
});
