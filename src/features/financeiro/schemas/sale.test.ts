import { describe, expect, it } from "vitest";

import { saleSchema } from "@/features/financeiro/schemas/sale";

const BASE = {
  idempotency_key: "11111111-1111-4111-8111-111111111111",
  lead_id: "22222222-2222-4222-8222-222222222222",
  procedure_name: "Rezum",
  total_amount: 1800,
  method: "pix" as const,
};

function fieldErrors(input: Record<string, unknown>) {
  const parsed = saleSchema.safeParse(input);
  if (parsed.success) return null;
  return parsed.error.flatten().fieldErrors;
}

describe("saleSchema — venda", () => {
  it("aceita o caso mínimo", () => {
    const parsed = saleSchema.safeParse(BASE);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.discount).toBe(0);
      expect(parsed.data.move_to_won).toBe(true);
    }
  });

  it("exige a forma de pagamento", () => {
    expect(fieldErrors({ ...BASE, method: undefined })).toMatchObject({
      method: ["Escolha a forma de pagamento."],
    });
  });
});

describe("saleSchema — valores", () => {
  it("recusa valor zero ou negativo", () => {
    expect(fieldErrors({ ...BASE, total_amount: 0 })?.total_amount).toBeDefined();
    expect(fieldErrors({ ...BASE, total_amount: -10 })?.total_amount).toBeDefined();
  });

  it("desconto maior que o total dá erro NO CAMPO discount", () => {
    const errors = fieldErrors({ ...BASE, total_amount: 100, discount: 200 });
    expect(errors).toMatchObject({
      discount: ["O desconto não pode passar do valor da venda."],
    });
    // O erro precisa cair no campo certo, não numa mensagem geral.
    expect(errors?.total_amount).toBeUndefined();
  });

  it("desconto igual ao total é aceito", () => {
    expect(saleSchema.safeParse({ ...BASE, total_amount: 100, discount: 100 }).success).toBe(
      true
    );
  });

  it("recusa desconto negativo", () => {
    expect(fieldErrors({ ...BASE, discount: -1 })?.discount).toBeDefined();
  });
});

describe("saleSchema — procedimento", () => {
  it("recusa nome em branco", () => {
    expect(fieldErrors({ ...BASE, procedure_name: "   " })?.procedure_name).toEqual([
      "Informe o procedimento.",
    ]);
  });

  it("recusa nome acima de 120 caracteres", () => {
    expect(fieldErrors({ ...BASE, procedure_name: "a".repeat(121) })?.procedure_name).toBeDefined();
  });

  it("apara espaços das pontas", () => {
    const parsed = saleSchema.safeParse({ ...BASE, procedure_name: "  HoLEP  " });
    expect(parsed.success && parsed.data.procedure_name).toBe("HoLEP");
  });
});

describe("saleSchema — acumula erros em vez de parar no primeiro", () => {
  it("nome vazio E desconto maior que o total saem juntos", () => {
    const errors = fieldErrors({
      ...BASE,
      procedure_name: "",
      total_amount: 100,
      discount: 500,
    });

    expect(errors?.procedure_name).toBeDefined();
    expect(errors?.discount).toBeDefined();
  });
});

describe("saleSchema — observações", () => {
  it("recusa acima de 500 caracteres", () => {
    expect(fieldErrors({ ...BASE, notes: "a".repeat(501) })?.notes).toBeDefined();
  });
});
