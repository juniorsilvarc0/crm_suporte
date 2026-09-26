import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  customerCreateSchema,
  customerUpdateSchema,
} from "@/features/customers/schemas/customer";

// O mesmo formato que a rota devolve em `errors`.
function fieldErrors(result: z.ZodSafeParseResult<unknown>) {
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
}

describe("customerCreateSchema", () => {
  it("apara os textos e normaliza o CNPJ numérico com máscara", () => {
    const result = customerCreateSchema.safeParse({
      legal_name: "  Padaria S. João Ltda ",
      trade_name: " Padaria São João ",
      cnpj: "11.222.333/0001-81",
      notes: " Cliente desde 2019. ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        legal_name: "Padaria S. João Ltda",
        trade_name: "Padaria São João",
        cnpj: "11222333000181",
        notes: "Cliente desde 2019.",
      });
    }
  });

  it("aceita o CNPJ alfanumérico em minúsculas e grava sem máscara, em caixa alta", () => {
    const result = customerCreateSchema.safeParse({
      legal_name: "Empresa Alfa",
      cnpj: "12.abc.345/01de-35",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cnpj).toBe("12ABC34501DE35");
  });

  it("recusa CNPJ com dígito verificador errado, com o erro no campo", () => {
    const result = customerCreateSchema.safeParse({
      legal_name: "Empresa Alfa",
      cnpj: "11.222.333/0001-80",
    });
    expect(result.success).toBe(false);
    expect(fieldErrors(result)).toEqual({
      cnpj: ["CNPJ inválido — confira os caracteres."],
    });
  });

  it("recusa CNPJ que só tem pontuação, em vez de gravá-lo como vazio", () => {
    const result = customerCreateSchema.safeParse({ legal_name: "Empresa Alfa", cnpj: "../-" });
    expect(fieldErrors(result)).toHaveProperty("cnpj");
  });

  it("recusa sequência repetida, que passa na conta do verificador", () => {
    const result = customerCreateSchema.safeParse({
      legal_name: "Empresa Alfa",
      cnpj: "00.000.000/0000-00",
    });
    expect(result.success).toBe(false);
  });

  it("transforma texto vazio em null", () => {
    const result = customerCreateSchema.safeParse({
      legal_name: "Empresa Alfa",
      trade_name: "   ",
      cnpj: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        legal_name: "Empresa Alfa",
        trade_name: null,
        cnpj: null,
        notes: null,
      });
    }
  });

  it("mantém ausente o que não veio", () => {
    const result = customerCreateSchema.safeParse({ legal_name: "Empresa Alfa" });
    expect(result.success).toBe(true);
    if (result.success) expect(Object.keys(result.data)).toEqual(["legal_name"]);
  });

  it("exige a razão social com ao menos 2 caracteres depois de aparar", () => {
    for (const legal_name of [undefined, "", "  A  "]) {
      const result = customerCreateSchema.safeParse({ legal_name });
      expect(fieldErrors(result)).toEqual({ legal_name: ["Informe a razão social."] });
    }
  });

  it("respeita os limites do banco", () => {
    const result = customerCreateSchema.safeParse({
      legal_name: "x".repeat(161),
      trade_name: "x".repeat(161),
      notes: "x".repeat(2001),
    });
    expect(fieldErrors(result)).toEqual({
      legal_name: ["Máximo de 160 caracteres."],
      trade_name: ["Máximo de 160 caracteres."],
      notes: ["Máximo de 2.000 caracteres."],
    });
  });

  it("recusa selo e arquivamento no corpo (.strict)", () => {
    expect(
      customerCreateSchema.safeParse({ legal_name: "Empresa Alfa", contract_status: "ativo" })
        .success
    ).toBe(false);
    expect(
      customerCreateSchema.safeParse({ legal_name: "Empresa Alfa", archived_at: null }).success
    ).toBe(false);
  });
});

describe("customerUpdateSchema", () => {
  it("devolve só as chaves enviadas: ausente não vira null", () => {
    const result = customerUpdateSchema.safeParse({ legal_name: " Nova Razão " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ legal_name: "Nova Razão" });
  });

  it("null e vazio explícitos limpam o campo", () => {
    const result = customerUpdateSchema.safeParse({ cnpj: null, trade_name: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ cnpj: null, trade_name: null });
  });

  it("normaliza e valida o CNPJ também na edição", () => {
    const ok = customerUpdateSchema.safeParse({ cnpj: "12abc34501de35" });
    expect(ok.success && ok.data).toEqual({ cnpj: "12ABC34501DE35" });

    const bad = customerUpdateSchema.safeParse({ cnpj: "12ABC34501DE36" });
    expect(fieldErrors(bad)).toHaveProperty("cnpj");
  });

  it("recusa corpo vazio", () => {
    const result = customerUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Nada para atualizar.");
  });

  it("recusa archived_at e contract_status no corpo", () => {
    expect(customerUpdateSchema.safeParse({ archived_at: null }).success).toBe(false);
    expect(customerUpdateSchema.safeParse({ contract_status: "encerrado" }).success).toBe(false);
    expect(
      customerUpdateSchema.safeParse({ legal_name: "Empresa Alfa", archived_at: null }).success
    ).toBe(false);
  });

  it("não aceita razão social vazia na edição", () => {
    const result = customerUpdateSchema.safeParse({ legal_name: "" });
    expect(fieldErrors(result)).toEqual({ legal_name: ["Informe a razão social."] });
  });
});
