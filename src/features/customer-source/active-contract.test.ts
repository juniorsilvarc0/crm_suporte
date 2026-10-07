import { describe, expect, it } from "vitest";

import { isActiveContract } from "@/features/customer-source/active-contract";
import type { CustomerContract } from "@/features/customer-source/types";

function contract(overrides: Partial<CustomerContract>): CustomerContract {
  return {
    id: 1,
    numero: null,
    modalidade: null,
    vigencia: null,
    dataInicio: null,
    dataFim: null,
    vencimentoDia: null,
    status: null,
    statusVigencia: null,
    dataAtivacao: null,
    ...overrides,
  };
}

describe("isActiveContract", () => {
  it("deve considerar ativo quando a vigência é 'ativo'", () => {
    expect(isActiveContract(contract({ statusVigencia: "ativo" }))).toBe(true);
  });

  it("deve ignorar caixa e espaços na vigência", () => {
    expect(isActiveContract(contract({ statusVigencia: "  Ativo " }))).toBe(true);
  });

  it("deve recusar vigência diferente de ativo", () => {
    expect(isActiveContract(contract({ statusVigencia: "encerrado" }))).toBe(false);
    expect(isActiveContract(contract({ statusVigencia: "suspenso" }))).toBe(false);
  });

  it("deve cair no status quando a vigência está ausente", () => {
    expect(isActiveContract(contract({ statusVigencia: null, status: "ativo" }))).toBe(true);
    expect(isActiveContract(contract({ statusVigencia: null, status: "cancelado" }))).toBe(false);
  });

  it("deve recusar quando vigência e status estão ausentes", () => {
    expect(isActiveContract(contract({}))).toBe(false);
  });
});
