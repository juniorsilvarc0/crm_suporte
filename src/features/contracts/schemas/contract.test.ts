import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  contractCreateSchema,
  contractStatusSchema,
  contractUpdateSchema,
  supportPlanCreateSchema,
} from "@/features/contracts/schemas/contract";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_A = "33333333-3333-4333-8333-333333333333";
const PRODUCT_B = "44444444-4444-4444-8444-444444444444";

// Como o formulário envia: campos de texto, vazio = "".
const formValues = {
  starts_on: "2026-09-01",
  ends_on: "",
  monthly_amount: "1500.00",
  billing_day: "10",
  plan_id: "",
  product_ids: [PRODUCT_A],
};

function fieldErrors(result: { error?: z.ZodError }): Record<string, string[] | undefined> {
  return result.error ? z.flattenError(result.error).fieldErrors : {};
}

describe("contractCreateSchema", () => {
  it("aceita o formulário, converte os campos e nasce ativo", () => {
    const result = contractCreateSchema.safeParse({ ...formValues, customer_id: CUSTOMER_ID });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      customer_id: CUSTOMER_ID,
      status: "ativo",
      starts_on: "2026-09-01",
      ends_on: null,
      monthly_amount: 1500,
      billing_day: 10,
      plan_id: null,
      product_ids: [PRODUCT_A],
    });
  });

  it("aceita nascer suspenso, mas não encerrado", () => {
    const base = { ...formValues, customer_id: CUSTOMER_ID };

    expect(contractCreateSchema.safeParse({ ...base, status: "suspenso" }).success).toBe(true);
    expect(contractCreateSchema.safeParse({ ...base, status: "encerrado" }).success).toBe(false);
  });

  it("exige a empresa como uuid", () => {
    const result = contractCreateSchema.safeParse({ ...formValues, customer_id: "abc" });

    expect(fieldErrors(result).customer_id).toEqual(["Empresa inválida."]);
  });

  it("recusa campo desconhecido (.strict)", () => {
    const result = contractCreateSchema.safeParse({
      ...formValues,
      customer_id: CUSTOMER_ID,
      created_by_user_id: CUSTOMER_ID,
    });

    expect(result.success).toBe(false);
  });
});

describe("datas do contrato", () => {
  it("recusa data que não existe no calendário", () => {
    const result = contractUpdateSchema.safeParse({ ...formValues, starts_on: "2026-02-30" });

    expect(fieldErrors(result).starts_on).toEqual(["Informe a data de início."]);
  });

  it("aceita término igual ao início e término nulo", () => {
    expect(contractUpdateSchema.safeParse({ ...formValues, ends_on: "2026-09-01" }).success).toBe(true);
    expect(contractUpdateSchema.safeParse({ ...formValues, ends_on: null }).data?.ends_on).toBeNull();
  });

  it("põe o erro de término antes do início no campo de término", () => {
    const result = contractUpdateSchema.safeParse({ ...formValues, ends_on: "2026-08-31" });

    expect(fieldErrors(result).ends_on).toEqual(["O término não pode ser antes do início."]);
  });

  it("exige a chave ends_on, para o PATCH não apagar o término em silêncio", () => {
    const withoutEndsOn: Record<string, unknown> = { ...formValues };
    delete withoutEndsOn.ends_on;

    expect(contractUpdateSchema.safeParse(withoutEndsOn).success).toBe(false);
  });
});

describe("valor mensal", () => {
  it.each([
    ["1500", 1500],
    ["1500.5", 1500.5],
    ["1500.55", 1500.55],
    ["0", 0],
    [" 99.90 ", 99.9],
    [1200.75, 1200.75],
    ["9999999999.99", 9999999999.99],
  ])("aceita %j", (input, expected) => {
    const result = contractUpdateSchema.safeParse({ ...formValues, monthly_amount: input });

    expect(result.data?.monthly_amount).toBe(expected);
  });

  it.each(["", "1500.555", "1500,00", "-10", "R$ 1500", "12345678901", "1e3", null])(
    "recusa %j com a mensagem do campo",
    (input) => {
      const result = contractUpdateSchema.safeParse({ ...formValues, monthly_amount: input });

      expect(fieldErrors(result).monthly_amount).toEqual(["Informe o valor mensal (ex.: 1500.00)."]);
    }
  );
});

describe("dia de vencimento", () => {
  it.each([["1", 1], ["28", 28], [15, 15]])("aceita %j", (input, expected) => {
    const result = contractUpdateSchema.safeParse({ ...formValues, billing_day: input });

    expect(result.data?.billing_day).toBe(expected);
  });

  it.each(["", "0", "29", "31", "10.5", "abc"])("recusa %j", (input) => {
    const result = contractUpdateSchema.safeParse({ ...formValues, billing_day: input });

    expect(fieldErrors(result).billing_day).toEqual(["Use um dia de 1 a 28."]);
  });
});

describe("plano e produtos", () => {
  it("aceita plano como uuid e recusa texto qualquer", () => {
    expect(contractUpdateSchema.safeParse({ ...formValues, plan_id: PLAN_ID }).data?.plan_id).toBe(PLAN_ID);
    expect(fieldErrors(contractUpdateSchema.safeParse({ ...formValues, plan_id: "ouro" })).plan_id).toEqual([
      "Plano inválido.",
    ]);
  });

  it("exige ao menos um produto", () => {
    const result = contractUpdateSchema.safeParse({ ...formValues, product_ids: [] });

    expect(fieldErrors(result).product_ids).toEqual(["Escolha ao menos um produto."]);
  });

  it("recusa produto repetido, inclusive com caixa diferente", () => {
    const result = contractUpdateSchema.safeParse({
      ...formValues,
      product_ids: [PRODUCT_A, PRODUCT_B, PRODUCT_A.toUpperCase()],
    });

    expect(fieldErrors(result).product_ids).toEqual(["O mesmo produto aparece mais de uma vez."]);
  });

  it("aceita até 50 produtos e recusa 51", () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

    expect(contractUpdateSchema.safeParse({ ...formValues, product_ids: ids(50) }).success).toBe(true);
    expect(contractUpdateSchema.safeParse({ ...formValues, product_ids: ids(51) }).success).toBe(false);
  });

  it("recusa id de produto fora do formato uuid", () => {
    const result = contractUpdateSchema.safeParse({ ...formValues, product_ids: ["produto-1"] });

    expect(result.success).toBe(false);
  });
});

describe("contractUpdateSchema", () => {
  it("recusa status e customer_id no corpo", () => {
    expect(contractUpdateSchema.safeParse({ ...formValues, status: "encerrado" }).success).toBe(false);
    expect(contractUpdateSchema.safeParse({ ...formValues, customer_id: CUSTOMER_ID }).success).toBe(false);
  });
});

describe("contractStatusSchema", () => {
  it("aceita as três situações, com ends_on opcional", () => {
    expect(contractStatusSchema.safeParse({ status: "suspenso" }).success).toBe(true);
    expect(contractStatusSchema.safeParse({ status: "ativo" }).success).toBe(true);
    expect(contractStatusSchema.safeParse({ status: "encerrado", ends_on: "2026-09-25" }).success).toBe(true);
    expect(contractStatusSchema.safeParse({ status: "encerrado", ends_on: null }).success).toBe(true);
  });

  it("recusa situação desconhecida, data inválida e campo extra", () => {
    expect(contractStatusSchema.safeParse({ status: "cancelado" }).success).toBe(false);
    expect(contractStatusSchema.safeParse({ status: "encerrado", ends_on: "2026-13-01" }).success).toBe(false);
    expect(contractStatusSchema.safeParse({ status: "ativo", monthly_amount: 10 }).success).toBe(false);
  });
});

describe("supportPlanCreateSchema", () => {
  it("apara o nome e transforma descrição vazia ou ausente em null", () => {
    expect(supportPlanCreateSchema.safeParse({ name: "  Ouro  " }).data).toEqual({ name: "Ouro", description: null });
    expect(supportPlanCreateSchema.safeParse({ name: "Ouro", description: "   " }).data?.description).toBeNull();
  });

  it("limita nome a 2..80 e descrição a 500", () => {
    expect(supportPlanCreateSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(supportPlanCreateSchema.safeParse({ name: "A".repeat(81) }).success).toBe(false);
    expect(supportPlanCreateSchema.safeParse({ name: "Ouro", description: "a".repeat(501) }).success).toBe(false);
  });

  it("recusa campo desconhecido, como preço", () => {
    expect(supportPlanCreateSchema.safeParse({ name: "Ouro", price: 100 }).success).toBe(false);
  });
});
