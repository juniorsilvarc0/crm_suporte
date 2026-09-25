import { describe, expect, it } from "vitest";

import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/formatters/cnpj";

describe("normalizeCnpj", () => {
  it("tira a máscara e sobe a caixa das letras", () => {
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(normalizeCnpj(" 11.222.333/0001-81 ")).toBe("11222333000181");
  });

  it("devolve string vazia para nulo, indefinido e vazio", () => {
    expect(normalizeCnpj(null)).toBe("");
    expect(normalizeCnpj(undefined)).toBe("");
    expect(normalizeCnpj("")).toBe("");
  });

  it("descarta letra fora do ASCII em vez de convertê-la em A–Z", () => {
    expect(normalizeCnpj("12ß3")).toBe("123");
    expect(normalizeCnpj("Ç1")).toBe("1");
  });
});

describe("isValidCnpj", () => {
  it("aceita o CNPJ alfanumérico (letra vale o código ASCII − 48)", () => {
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
  });

  it("aceita letras minúsculas, que viram maiúsculas ao normalizar", () => {
    expect(isValidCnpj("12.abc.345/01de-35")).toBe(true);
  });

  it("aceita o CNPJ numérico", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("12.ABC.345/01DE-36")).toBe(false);
  });

  it("recusa quando uma letra da raiz muda e o DV não acompanha", () => {
    expect(isValidCnpj("12.ABD.345/01DE-35")).toBe(false);
  });

  it("recusa sequência repetida, mesmo que o DV feche", () => {
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
  });

  it("recusa letra na posição do DV", () => {
    expect(isValidCnpj("12ABC34501DE3A")).toBe(false);
  });

  it("recusa tamanho diferente de 14", () => {
    expect(isValidCnpj("1122233300018")).toBe(false);
    expect(isValidCnpj("112223330001811")).toBe(false);
  });

  it("recusa nulo, indefinido e vazio", () => {
    expect(isValidCnpj(null)).toBe(false);
    expect(isValidCnpj(undefined)).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });
});

describe("formatCnpj", () => {
  it("aplica a máscara XX.XXX.XXX/XXXX-XX", () => {
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("normaliza antes de mascarar", () => {
    expect(formatCnpj("12.abc.345/01de-35")).toBe("12.ABC.345/01DE-35");
  });

  it("devolve a entrada crua quando não tem 14 caracteres", () => {
    expect(formatCnpj("12.ABC")).toBe("12.ABC");
    expect(formatCnpj("")).toBe("");
  });

  it("devolve string vazia para nulo e indefinido", () => {
    expect(formatCnpj(null)).toBe("");
    expect(formatCnpj(undefined)).toBe("");
  });
});
