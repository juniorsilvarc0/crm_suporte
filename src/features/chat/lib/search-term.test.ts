import { describe, expect, it } from "vitest";

import { escapeLikePattern, highlightSlices } from "@/features/chat/lib/search-term";

describe("escapeLikePattern", () => {
  it("escapa os curingas do LIKE", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("c:\\temp")).toBe("c:\\\\temp");
  });

  it("texto comum passa intacto", () => {
    expect(escapeLikePattern("pdv")).toBe("pdv");
    expect(escapeLikePattern("consulta às 9h")).toBe("consulta às 9h");
  });
});

describe("highlightSlices", () => {
  const texto = (slices: ReturnType<typeof highlightSlices>) =>
    slices.map((s) => s.text).join("");

  it("marca a ocorrência e preserva o texto original", () => {
    const slices = highlightSlices("Quero saber do PDV", "pdv");
    expect(texto(slices)).toBe("Quero saber do PDV");
    expect(slices.filter((s) => s.match).map((s) => s.text)).toEqual(["PDV"]);
  });

  it("ignora acento nos DOIS lados, sem deslocar o recorte", () => {
    const slices = highlightSlices("Marquei a consultá de manhã", "consulta");
    expect(texto(slices)).toBe("Marquei a consultá de manhã");
    // O trecho destacado é o do texto original, com o acento preservado.
    expect(slices.filter((s) => s.match).map((s) => s.text)).toEqual(["consultá"]);
  });

  it("acha várias ocorrências", () => {
    const slices = highlightSlices("erro, erro e erro", "erro");
    expect(slices.filter((s) => s.match)).toHaveLength(3);
    expect(texto(slices)).toBe("erro, erro e erro");
  });

  it("sem ocorrência devolve o texto inteiro sem marca", () => {
    const slices = highlightSlices("bom dia", "pdv");
    expect(slices).toEqual([{ text: "bom dia", match: false }]);
  });

  it("termo vazio ou só espaço não marca nada", () => {
    expect(highlightSlices("bom dia", "")).toEqual([{ text: "bom dia", match: false }]);
    expect(highlightSlices("bom dia", "   ")).toEqual([{ text: "bom dia", match: false }]);
  });

  it("texto vazio não quebra", () => {
    expect(highlightSlices("", "x")).toEqual([{ text: "", match: false }]);
  });

  it("ocorrência no começo e no fim", () => {
    const slices = highlightSlices("oi tudo bem oi", "oi");
    expect(texto(slices)).toBe("oi tudo bem oi");
    expect(slices[0]).toEqual({ text: "oi", match: true });
    expect(slices[slices.length - 1]).toEqual({ text: "oi", match: true });
  });

  it("emoji no meio não desalinha o recorte", () => {
    const slices = highlightSlices("agendado 😊 para segunda", "segunda");
    expect(texto(slices)).toBe("agendado 😊 para segunda");
    expect(slices.filter((s) => s.match).map((s) => s.text)).toEqual(["segunda"]);
  });
});
