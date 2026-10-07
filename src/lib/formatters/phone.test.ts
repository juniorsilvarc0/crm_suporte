import { describe, expect, it } from "vitest";

import { formatPhone, formatPhoneBR, normalizePhone, phoneLookupCandidates } from "@/lib/formatters/phone";

describe("normalizePhone", () => {
  it("remove todos os caracteres não numéricos", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("11987654321");
  });

  it("mantém string vazia quando não há dígitos", () => {
    expect(normalizePhone("abc")).toBe("");
  });

  it("retorna a mesma string quando já é só dígitos", () => {
    expect(normalizePhone("11987654321")).toBe("11987654321");
  });

  it("remove o DDI 55 para casar WhatsApp e cadastro manual na mesma chave", () => {
    expect(normalizePhone("5527999990000")).toBe("27999990000");
    expect(normalizePhone("(27) 99999-0000")).toBe("27999990000");
    expect(normalizePhone("+55 27 99999-0000")).toBe("27999990000");
  });

  it("não remove o DDD 55 (Rio Grande do Sul) de um número nacional de 11 dígitos", () => {
    expect(normalizePhone("55999990000")).toBe("55999990000");
  });
});

describe("formatPhone", () => {
  it("retorna '-' quando o valor é null", () => {
    expect(formatPhone(null)).toBe("-");
  });

  it("formata número de celular com 11 dígitos (DDD + 9 dígitos)", () => {
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
  });

  it("formata número fixo com 10 dígitos", () => {
    expect(formatPhone("1132654321")).toBe("(11) 3265-4321");
  });

  it("formata a partir de string já pontuada, ignorando os símbolos", () => {
    expect(formatPhone("(11) 98765-4321")).toBe("(11) 98765-4321");
  });

  it("retorna o valor original quando a quantidade de dígitos não é 10 nem 11", () => {
    expect(formatPhone("123")).toBe("123");
  });

  it("retorna o valor original quando a string está vazia", () => {
    expect(formatPhone("")).toBe("-");
  });
});

describe("formatPhoneBR", () => {
  it("retorna '-' quando o valor é null", () => {
    expect(formatPhoneBR(null)).toBe("-");
  });

  it("acrescenta o 9º dígito em número com DDD + 8 dígitos (10 no total)", () => {
    // (86) 9000-0011  ->  (86) 99000-0011
    expect(formatPhoneBR("8690000011")).toBe("(86) 99000-0011");
  });

  it("acrescenta o 9º dígito também quando vem com DDI 55", () => {
    expect(formatPhoneBR("558690000011")).toBe("(86) 99000-0011");
  });

  it("mantém número que já tem o 9º dígito (11 dígitos)", () => {
    expect(formatPhoneBR("11987654321")).toBe("(11) 98765-4321");
  });

  it("formata a partir de string já pontuada de 8 dígitos locais", () => {
    expect(formatPhoneBR("(86) 9000-0011")).toBe("(86) 99000-0011");
  });

  it("cai no formato padrão quando não há 10 nem 11 dígitos", () => {
    expect(formatPhoneBR("123")).toBe("123");
  });
});

describe("phoneLookupCandidates", () => {
  it("celular (com o 9): tenta COM o 9 primeiro, depois sem, depois com 55", () => {
    expect(phoneLookupCandidates("5586994259816")).toEqual([
      "86994259816",
      "8694259816",
      "5586994259816",
      "558694259816",
    ]);
  });

  it("+55 e formatação são indiferentes — mesmas variações", () => {
    expect(phoneLookupCandidates("+55 (86) 99425-9816")).toEqual(phoneLookupCandidates("86994259816"));
  });

  it("número com DDD + 8 (sem o 9): tenta sem o 9 primeiro", () => {
    expect(phoneLookupCandidates("8699783446")).toEqual([
      "8699783446",
      "86999783446",
      "558699783446",
      "5586999783446",
    ]);
  });

  it("curto demais (sem DDD + 8): nenhuma variação", () => {
    expect(phoneLookupCandidates("994259816")).toEqual([]);
    expect(phoneLookupCandidates("")).toEqual([]);
  });
});
