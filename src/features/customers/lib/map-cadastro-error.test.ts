import { describe, expect, it } from "vitest";

import { mapCadastroError } from "@/features/customers/lib/map-cadastro-error";

// Mensagens no formato real: RPC/trigger levanta só a TAG (P0001); o Postgres
// cita a constraint entre aspas nos erros 23505/23514/23503.
const unique = (name: string) => ({
  code: "23505",
  message: `duplicate key value violates unique constraint "${name}"`,
});
const check = (table: string, name: string) => ({
  code: "23514",
  message: `new row for relation "${table}" violates check constraint "${name}"`,
});

describe("mapCadastroError — TAG das RPCs e triggers", () => {
  it.each([
    ["FORBIDDEN", 403, "Apenas administradores podem executar esta ação.", undefined],
    ["CUSTOMER_NOT_FOUND", 404, "Empresa não encontrada.", "customer_id"],
    ["CONTRACT_NOT_FOUND", 404, "Contrato não encontrado.", undefined],
    [
      "CURRENT_CONTRACT_EXISTS",
      409,
      "Esta empresa já tem um contrato vigente. Encerre-o antes de criar outro.",
      undefined,
    ],
    ["CONTRACT_CLOSED", 409, "Contrato encerrado não pode ser alterado. Crie um novo.", undefined],
    [
      "CUSTOMER_HAS_CURRENT_CONTRACT",
      409,
      "Encerre o contrato vigente antes de arquivar a empresa.",
      undefined,
    ],
    ["CUSTOMER_ARCHIVED", 422, "Empresa arquivada. Reative-a antes.", "customer_id"],
    ["PLAN_NOT_FOUND", 422, "Plano não encontrado.", "plan_id"],
    ["PLAN_ARCHIVED", 422, "Plano arquivado.", "plan_id"],
    ["PRODUCT_NOT_FOUND", 422, "Produto não encontrado.", "product_ids"],
    ["PRODUCT_ARCHIVED", 422, "Um dos produtos foi arquivado.", "product_ids"],
    ["PRODUCTS_REQUIRED", 400, "Escolha ao menos um produto.", "product_ids"],
    ["TOO_MANY_PRODUCTS", 400, "Produtos demais.", "product_ids"],
    ["INVALID_STATUS", 400, "Situação inválida.", "status"],
  ])("%s → %i", (tag, status, message, field) => {
    expect(mapCadastroError({ code: "P0001", message: tag })).toEqual(
      field ? { status, message, field } : { status, message }
    );
  });
});

describe("mapCadastroError — constraint na message", () => {
  it.each([
    [
      unique("support_contracts_one_current_per_customer_uidx"),
      409,
      "Esta empresa já tem um contrato vigente. Encerre-o antes de criar outro.",
      undefined,
    ],
    [unique("customers_cnpj_active_uidx"), 409, "Já existe empresa ativa com este CNPJ.", "cnpj"],
    [
      check("customers", "customers_cnpj_format_check"),
      422,
      "CNPJ inválido — confira os caracteres.",
      "cnpj",
    ],
    [unique("products_name_active_uidx"), 409, "Já existe um produto com este nome.", "name"],
    [unique("support_plans_name_active_uidx"), 409, "Já existe um plano com este nome.", "name"],
    [
      check("support_contracts", "support_contracts_term_check"),
      422,
      "O término não pode ser antes do início.",
      "ends_on",
    ],
    [
      check("support_contracts", "support_contracts_billing_day_check"),
      422,
      "Use um dia de 1 a 28.",
      "billing_day",
    ],
    [
      check("support_contracts", "support_contracts_amount_check"),
      422,
      "Valor inválido.",
      "monthly_amount",
    ],
    [
      {
        code: "23503",
        message:
          'insert or update on table "contacts" violates foreign key constraint "contacts_customer_id_fkey"',
      },
      422,
      "Empresa não encontrada.",
      "customer_id",
    ],
  ])("%o → %i", (error, status, message, field) => {
    expect(mapCadastroError(error)).toEqual(field ? { status, message, field } : { status, message });
  });
});

describe("mapCadastroError — code", () => {
  it("42501 sem TAG é bug (grant faltando): 500, nunca 403", () => {
    expect(
      mapCadastroError({ code: "42501", message: "permission denied for table support_contracts" })
    ).toEqual({ status: 500, message: "Não foi possível concluir a operação." });
  });

  it.each(["22P02", "22003", "22008", "23502"])("%s → 400", (code) => {
    expect(mapCadastroError({ code, message: "qualquer" })).toEqual({
      status: 400,
      message: "Revise os campos destacados.",
    });
  });

  it("cai em 500 para o resto, inclusive constraint que a tabela não conhece", () => {
    expect(mapCadastroError(unique("outra_constraint_uidx")).status).toBe(500);
    expect(mapCadastroError(check("customers", "customers_notes_check")).status).toBe(500);
    expect(mapCadastroError({ code: "PGRST000", message: "algo inesperado" }).status).toBe(500);
    expect(mapCadastroError(null).status).toBe(500);
    expect(mapCadastroError(undefined).status).toBe(500);
  });
});

describe("mapCadastroError — ordem de leitura", () => {
  it("TAG vence o code: FORBIDDEN com 42501 continua 403", () => {
    expect(mapCadastroError({ code: "42501", message: "FORBIDDEN" }).status).toBe(403);
  });

  it("TAG vence a constraint", () => {
    expect(
      mapCadastroError({
        code: "P0001",
        message: 'CUSTOMER_ARCHIVED (via "contacts_customer_id_fkey")',
      })
    ).toEqual({ status: 422, message: "Empresa arquivada. Reative-a antes.", field: "customer_id" });
  });

  it("constraint vence o code: 23505 de CNPJ é 409, não 400 nem 500", () => {
    expect(mapCadastroError(unique("customers_cnpj_active_uidx")).status).toBe(409);
  });

  it("CUSTOMER_HAS_CURRENT_CONTRACT não é lido como CURRENT_CONTRACT_EXISTS", () => {
    expect(mapCadastroError({ message: "CUSTOMER_HAS_CURRENT_CONTRACT" }).message).toBe(
      "Encerre o contrato vigente antes de arquivar a empresa."
    );
  });

  it("devolve uma cópia: alterar a resposta não altera a próxima", () => {
    const first = mapCadastroError({ message: "FORBIDDEN" });
    first.message = "alterada";
    expect(mapCadastroError({ message: "FORBIDDEN" }).message).toBe(
      "Apenas administradores podem executar esta ação."
    );
  });
});
