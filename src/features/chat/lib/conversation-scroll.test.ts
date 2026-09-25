import { describe, expect, it } from "vitest";

import {
  detectConversationPromotion,
  promotedConversationScrollShift,
  promotedShiftPixels,
  viewportIndexFromHeights,
} from "@/features/chat/lib/conversation-scroll";

describe("detectConversationPromotion", () => {
  it("detecta conversa que sobe do fim para o topo", () => {
    expect(
      detectConversationPromotion(["a", "b", "c"], ["c", "a", "b"], "c")
    ).toEqual({ id: "c", previousIndex: 2, nextIndex: 0 });
  });

  it("detecta conversa que sobe sem chegar ao topo", () => {
    expect(
      detectConversationPromotion(
        ["a", "b", "c", "d"],
        ["a", "d", "b", "c"],
        "d"
      )
    ).toEqual({ id: "d", previousIndex: 3, nextIndex: 1 });
  });

  it("ignora atualização que mantém a posição", () => {
    expect(
      detectConversationPromotion(["a", "b", "c"], ["a", "b", "c"], "b")
    ).toBeNull();
  });

  it("ignora conversa que desce mesmo quando outras sobem por consequência", () => {
    expect(
      detectConversationPromotion(["a", "b", "c"], ["b", "c", "a"], "a")
    ).toBeNull();
  });

  it("ignora atualização de conversa ausente", () => {
    expect(
      detectConversationPromotion(["a", "b"], ["a", "b"], "fora")
    ).toBeNull();
  });

  it("trata conversa nova inserida no topo como promoção", () => {
    expect(
      detectConversationPromotion(["a", "b"], ["nova", "a", "b"], "nova")
    ).toEqual({ id: "nova", previousIndex: -1, nextIndex: 0 });
  });

  it("não trata a carga inicial como promoção", () => {
    expect(
      detectConversationPromotion([], ["a", "b", "c"], "a")
    ).toBeNull();
  });
});

describe("promotedConversationScrollShift", () => {
  it("compensa quando a conversa cruza o topo da viewport", () => {
    expect(
      promotedConversationScrollShift(
        { id: "c", previousIndex: 20, nextIndex: 0 },
        10
      )
    ).toBe(1);
  });

  it("não compensa quando origem e destino já estavam acima da viewport", () => {
    expect(
      promotedConversationScrollShift(
        { id: "c", previousIndex: 5, nextIndex: 0 },
        10
      )
    ).toBe(0);
  });

  it("compensa conversa nova inserida acima da viewport", () => {
    expect(
      promotedConversationScrollShift(
        { id: "nova", previousIndex: -1, nextIndex: 0 },
        10
      )
    ).toBe(1);
  });
});

describe("viewportIndexFromHeights", () => {
  it("topo da lista é sempre a primeira linha", () => {
    expect(viewportIndexFromHeights([72, 72, 72], 0)).toBe(0);
  });

  it("acha a linha visível com alturas iguais", () => {
    // 3 linhas de 72px: 0–72, 72–144, 144–216.
    expect(viewportIndexFromHeights([72, 72, 72], 80)).toBe(1);
    expect(viewportIndexFromHeights([72, 72, 72], 150)).toBe(2);
  });

  it("acerta quando a PRIMEIRA linha é mais alta — o caso que a divisão errava", () => {
    // A primeira tem etiqueta (96px), as outras não (72px).
    // Dividir 100 pela altura da primeira daria índice 1; o correto é 1 também,
    // mas em 180 a divisão daria 1 e o correto é 2.
    const heights = [96, 72, 72, 72];
    expect(viewportIndexFromHeights(heights, 180)).toBe(2);
    expect(Math.floor(180 / heights[0])).toBe(1); // o que o cálculo antigo daria
  });

  it("acerta quando a linha alta está no meio", () => {
    // 72 | 72 | 120 (duas etiquetas) | 72  →  0–72, 72–144, 144–264, 264–336
    const heights = [72, 72, 120, 72];
    expect(viewportIndexFromHeights(heights, 200)).toBe(2);
    expect(viewportIndexFromHeights(heights, 270)).toBe(3);
  });

  it("borda exata cai na linha seguinte", () => {
    // Em 72 o primeiro pixel visível já pertence à segunda linha.
    expect(viewportIndexFromHeights([72, 72], 72)).toBe(1);
  });

  it("lista vazia e lista escondida não explodem", () => {
    expect(viewportIndexFromHeights([], 500)).toBe(0);
    // Lista escondida no celular: geometria zerada, scrollTop preservado.
    expect(viewportIndexFromHeights([0, 0, 0], 0)).toBe(0);
  });

  it("scroll além do fim para na última linha", () => {
    expect(viewportIndexFromHeights([72, 72], 10_000)).toBe(1);
  });
});

describe("promotedShiftPixels", () => {
  const heights = new Map([
    ["a", 96],
    ["b", 72],
  ]);

  it("soma a altura real de cada linha que entrou", () => {
    expect(promotedShiftPixels(["a"], heights, 72)).toBe(96);
    expect(promotedShiftPixels(["a", "b"], heights, 72)).toBe(168);
  });

  it("linha que sumiu entra pela altura típica", () => {
    expect(promotedShiftPixels(["sumiu"], heights, 72)).toBe(72);
    expect(promotedShiftPixels(["a", "sumiu"], heights, 72)).toBe(168);
  });

  it("altura medida como zero também cai na típica", () => {
    // Acontece quando a linha existe mas a lista está escondida.
    expect(promotedShiftPixels(["z"], new Map([["z", 0]]), 72)).toBe(72);
  });

  it("nada pendente não desloca nada", () => {
    expect(promotedShiftPixels([], heights, 72)).toBe(0);
  });
});
