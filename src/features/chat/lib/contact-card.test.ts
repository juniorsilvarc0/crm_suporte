import { describe, expect, it } from "vitest";

import { parseContactMessage } from "@/features/chat/lib/contact-card";

// Os casos abaixo são as mensagens REAIS de produção (14 no total, tipo
// `contact`). Se o formato do provedor mudar, é aqui que quebra primeiro.
describe("parseContactMessage — amostras de produção", () => {
  it("contato simples", () => {
    expect(parseContactMessage("Lead Chagas\nPhone: +55 69 99000-0009")).toEqual([
      {
        name: "Lead Chagas",
        businessName: null,
        phones: [{ label: null, number: "+55 69 99000-0009" }],
      },
    ]);
  });

  it("conta comercial: guarda o nome do negócio e ignora a descrição", () => {
    const cards = parseContactMessage(
      "Emerson Somma\nX-Wa-Biz-Name: Emerson Santos Corporativo\nX-Wa-Biz-Description: Sommaph\nPhone: +55 11 99000-0006"
    );
    expect(cards).toEqual([
      {
        name: "Emerson Somma",
        businessName: "Emerson Santos Corporativo",
        phones: [{ label: null, number: "+55 11 99000-0006" }],
      },
    ]);
  });

  it("DOIS contatos numerados, com linhas indentadas", () => {
    const cards = parseContactMessage(
      "1. Caixa Moriah\n   Phone: +55 11 99000-0008\n2. Hospital Moriah - RH / Financeiro\n   X-Wa-Biz-Name: Hospital Moriah - RH / Financeiro\n   Phone: +55 11 99000-0003"
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      name: "Caixa Moriah",
      businessName: null,
      phones: [{ label: null, number: "+55 11 99000-0008" }],
    });
    expect(cards[1].name).toBe("Hospital Moriah - RH / Financeiro");
    expect(cards[1].phones).toEqual([{ label: null, number: "+55 11 99000-0003" }]);
  });

  it("DOIS telefones no mesmo contato, um deles rotulado", () => {
    const cards = parseContactMessage(
      "Joao Carlos STORM\nPhone (Nextel): +55 11 99000-0005\nPhone: +55 11 99000-0007"
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].phones).toEqual([
      { label: "Nextel", number: "+55 11 99000-0005" },
      { label: null, number: "+55 11 99000-0007" },
    ]);
  });

  it("rótulo 'Outros'", () => {
    const cards = parseContactMessage("Ane\nPhone (Outros): +55 11 99000-0004");
    expect(cards[0].phones[0]).toEqual({ label: "Outros", number: "+55 11 99000-0004" });
  });

  it("nome com ponto e barra não vira outra coisa", () => {
    const cards = parseContactMessage("Ana Souza\nPhone: +55 11 99000-0010");
    expect(cards[0].name).toBe("Ana Souza");
  });
});

describe("parseContactMessage — bordas", () => {
  it("vazio, nulo e só espaço devolvem lista vazia", () => {
    expect(parseContactMessage("")).toEqual([]);
    expect(parseContactMessage(null)).toEqual([]);
    expect(parseContactMessage(undefined)).toEqual([]);
    expect(parseContactMessage("   \n  ")).toEqual([]);
  });

  it("só telefone, sem nome, ainda vira card", () => {
    const cards = parseContactMessage("Phone: +55 11 90000-0000");
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Contato");
    expect(cards[0].phones).toHaveLength(1);
  });

  it("texto que não é vCard vira card só com nome — a bolha decide o que fazer", () => {
    expect(parseContactMessage("Fulano")).toEqual([
      { name: "Fulano", businessName: null, phones: [] },
    ]);
  });

  it("descarta contato que ficaria sem nome E sem telefone", () => {
    expect(parseContactMessage("X-Wa-Biz-Description: só ruído")).toEqual([]);
  });

  it("telefone vazio é ignorado", () => {
    const cards = parseContactMessage("Fulano\nPhone:   ");
    expect(cards[0].phones).toEqual([]);
  });

  it("linhas em branco no meio não criam contato fantasma", () => {
    const cards = parseContactMessage("Fulano\n\nPhone: +55 11 90000-0000\n\n");
    expect(cards).toHaveLength(1);
  });

  it("item numerado sem nome cai no rótulo padrão", () => {
    const cards = parseContactMessage("1. \n   Phone: +55 11 90000-0000");
    expect(cards[0].name).toBe("Contato");
    expect(cards[0].phones).toHaveLength(1);
  });

  it("case do cabeçalho não importa", () => {
    const cards = parseContactMessage("Fulano\nPHONE: +55 11 90000-0000\nx-wa-biz-name: ACME");
    expect(cards[0].phones).toHaveLength(1);
    expect(cards[0].businessName).toBe("ACME");
  });
});
