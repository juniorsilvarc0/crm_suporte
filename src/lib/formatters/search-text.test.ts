import { describe, expect, it } from "vitest";

import { normalizeSearchText, searchTokens } from "@/lib/formatters/search-text";

// Os valores esperados de normalizeSearchText saíram de
// `select public.normalize_search_text(...)` no banco local: é o espelho do SQL.
describe("normalizeSearchText", () => {
  it("gera o search_name da empresa igual ao banco (vetor C06)", () => {
    // Mesma concatenação da coluna gerada: fantasia · razão social · CNPJ.
    const tradeName = "Padaria São João";
    const legalName = "Padaria S. João Ltda";
    const cnpj = "12ABC34501DE35";

    expect(normalizeSearchText(`${tradeName} ${legalName} ${cnpj}`)).toBe(
      "padaria sao joao padaria s joao ltda 12abc34501de35",
    );
  });

  it("tira o acento de maiúscula acentuada", () => {
    expect(normalizeSearchText("Ângela")).toBe("angela");
  });

  it("cobre as 48 letras da tabela do translate", () => {
    expect(normalizeSearchText("ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑáàãâäéèêëíìîïóòõôöúùûüçñ")).toBe(
      "aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn",
    );
  });

  it("troca por espaço a letra fora da tabela, como o SQL", () => {
    expect(normalizeSearchText("  Øresund — Ltda./ME ")).toBe("resund ltda me");
  });

  it("colapsa pontuação e espaços e apara as pontas", () => {
    expect(normalizeSearchText("  Padaria   S.A. (Filial)  ")).toBe("padaria s a filial");
  });

  it("devolve string vazia para nulo e indefinido", () => {
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("searchTokens", () => {
  it("normaliza e divide o termo em tokens", () => {
    expect(searchTokens("Padaria São  João")).toEqual(["padaria", "sao", "joao"]);
  });

  it("quebra o CNPJ com máscara em blocos, todos contidos no search_name", () => {
    expect(searchTokens("12.ABC.345/01DE-35")).toEqual(["12", "abc", "345", "01de", "35"]);
  });

  it("descarta tokens com menos de 2 caracteres", () => {
    expect(searchTokens("a padaria b de")).toEqual(["padaria", "de"]);
    expect(searchTokens("a b")).toEqual([]);
  });

  it("devolve no máximo 5 tokens", () => {
    expect(searchTokens("um dois tres quatro cinco seis sete")).toEqual([
      "um",
      "dois",
      "tres",
      "quatro",
      "cinco",
    ]);
  });

  it("corta o termo em 100 caracteres antes de normalizar", () => {
    const query = `${"x".repeat(99)}yz`;
    expect(searchTokens(query)).toEqual([`${"x".repeat(99)}y`]);
  });

  it("devolve lista vazia para termo vazio, só pontuação, nulo ou indefinido", () => {
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens(" .-/ ")).toEqual([]);
    expect(searchTokens(null)).toEqual([]);
    expect(searchTokens(undefined)).toEqual([]);
  });
});
