import { describe, expect, it } from "vitest";

import {
  parseWhatsappText,
  stripWhatsappFormat,
  type FormattedNode,
} from "@/features/chat/lib/whatsapp-format";

const text = (value: string): FormattedNode => ({ type: "text", value });

describe("parseWhatsappText", () => {
  it("texto sem marcador sai inteiro", () => {
    expect(parseWhatsappText("Olá, tudo bem?")).toEqual([text("Olá, tudo bem?")]);
  });

  it("vazio devolve lista vazia", () => {
    expect(parseWhatsappText("")).toEqual([]);
  });

  it("negrito", () => {
    expect(parseWhatsappText("*Carla*")).toEqual([
      { type: "bold", children: [text("Carla")] },
    ]);
  });

  it("o caso do print: *Carla:* seguido de quebra de linha", () => {
    expect(parseWhatsappText("*Carla:*\nOi, Jaime!")).toEqual([
      { type: "bold", children: [text("Carla:")] },
      text("\nOi, Jaime!"),
    ]);
  });

  it("itálico, riscado e mono", () => {
    expect(parseWhatsappText("_oi_")).toEqual([{ type: "italic", children: [text("oi")] }]);
    expect(parseWhatsappText("~oi~")).toEqual([{ type: "strike", children: [text("oi")] }]);
    expect(parseWhatsappText("`oi`")).toEqual([{ type: "mono", children: [text("oi")] }]);
  });

  it("marcador no meio da frase", () => {
    expect(parseWhatsappText("valor *R$ 1.850* fechado")).toEqual([
      text("valor "),
      { type: "bold", children: [text("R$ 1.850")] },
      text(" fechado"),
    ]);
  });

  it("aninha formatações", () => {
    expect(parseWhatsappText("*_forte_*")).toEqual([
      { type: "bold", children: [{ type: "italic", children: [text("forte")] }] },
    ]);
  });

  it("MARCADOR SEM PAR fica literal", () => {
    expect(parseWhatsappText("2 * 3 = 6")).toEqual([text("2 * 3 = 6")]);
    expect(parseWhatsappText("um * solto")).toEqual([text("um * solto")]);
    expect(parseWhatsappText("*sem fechar")).toEqual([text("*sem fechar")]);
  });

  it("não formata grudado numa palavra — 2*3*4 é conta, não negrito", () => {
    expect(parseWhatsappText("2*3*4")).toEqual([text("2*3*4")]);
    expect(parseWhatsappText("snake_case_aqui")).toEqual([text("snake_case_aqui")]);
  });

  it("espaço logo depois do marcador não abre", () => {
    expect(parseWhatsappText("* não é negrito *")).toEqual([text("* não é negrito *")]);
  });

  it("marcador vazio fica literal", () => {
    expect(parseWhatsappText("**")).toEqual([text("**")]);
    expect(parseWhatsappText("____")).toEqual([text("____")]);
  });

  it("bloco ``` não formata o conteúdo", () => {
    expect(parseWhatsappText("```*nao* _muda_```")).toEqual([
      { type: "block", value: "*nao* _muda_" },
    ]);
  });

  it("bloco sem fechamento fica literal", () => {
    expect(parseWhatsappText("```aberto")).toEqual([text("```aberto")]);
  });

  it("bloco no meio do texto", () => {
    expect(parseWhatsappText("veja ```cmd``` ok")).toEqual([
      text("veja "),
      { type: "block", value: "cmd" },
      text(" ok"),
    ]);
  });

  it("emoji e acento atravessam sem quebrar", () => {
    expect(parseWhatsappText("*procedimento* 😊 é ótimo")).toEqual([
      { type: "bold", children: [text("procedimento")] },
      text(" 😊 é ótimo"),
    ]);
  });

  it("negrito atravessando linhas", () => {
    expect(parseWhatsappText("*duas\nlinhas*")).toEqual([
      { type: "bold", children: [text("duas\nlinhas")] },
    ]);
  });

  it("dois trechos em negrito na mesma frase", () => {
    expect(parseWhatsappText("*um* e *dois*")).toEqual([
      { type: "bold", children: [text("um")] },
      text(" e "),
      { type: "bold", children: [text("dois")] },
    ]);
  });

  it("não engasga com texto grande cheio de marcador solto", () => {
    const ruido = "*".repeat(300);
    expect(() => parseWhatsappText(ruido)).not.toThrow();
  });
});

describe("stripWhatsappFormat", () => {
  it("tira os marcadores para a prévia", () => {
    expect(stripWhatsappFormat("*Carla:*\nOi!")).toBe("Carla:\nOi!");
  });

  it("preserva o que não é marcação", () => {
    expect(stripWhatsappFormat("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("bloco vira o conteúdo puro", () => {
    expect(stripWhatsappFormat("```codigo```")).toBe("codigo");
  });
});
