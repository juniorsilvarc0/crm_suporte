import { describe, expect, it } from "vitest";

import {
  cancelsConversationLongPress,
  clampConversationSwipe,
  conversationSwipeMoved,
  conversationSwipeOffset,
  detectConversationSwipeAxis,
  settleConversationSwipe,
} from "@/features/chat/lib/conversation-swipe";

describe("gesto lateral da conversa", () => {
  it("espera movimento suficiente antes de escolher o eixo", () => {
    expect(detectConversationSwipeAxis(-5, 2)).toBe("pending");
  });

  it("trata o escorregão do polegar como toque, não como arraste", () => {
    // Um toque em tela de celular anda de 6 a 10 px. Com o limiar antigo de 8 px
    // isto virava arraste e o clique de abrir a conversa era engolido.
    expect(detectConversationSwipeAxis(-9, 3)).toBe("pending");
    expect(detectConversationSwipeAxis(6, -7)).toBe("pending");
  });

  it("não captura a rolagem vertical da lista", () => {
    expect(detectConversationSwipeAxis(-10, 28)).toBe("vertical");
    expect(detectConversationSwipeAxis(-30, 5)).toBe("horizontal");
  });

  it("deixa a rolagem na diagonal para a lista", () => {
    // Primeira amostra de uma rolagem torta. Com dominância 1.15 o eixo travava
    // em horizontal e a lista parava de rolar no meio do gesto.
    expect(detectConversationSwipeAxis(-14, 12)).toBe("vertical");
  });

  it("limita o arraste à largura das duas ações, dos DOIS lados", () => {
    expect(clampConversationSwipe(-999)).toBe(-152);
    expect(clampConversationSwipe(999)).toBe(152);
    // Antes o lado direito era cortado em 0: só existia arraste para a esquerda.
    expect(clampConversationSwipe(20)).toBe(20);
  });

  it("abre apenas depois de cruzar o limiar visual", () => {
    expect(settleConversationSwipe(-40)).toBeNull();
    expect(settleConversationSwipe(-60)).toBe("trailing");
    expect(settleConversationSwipe(40)).toBeNull();
    expect(settleConversationSwipe(60)).toBe("leading");
  });

  it("linha parada volta ao lugar", () => {
    expect(settleConversationSwipe(0)).toBeNull();
  });

  it("cada lado tem seu repouso", () => {
    expect(conversationSwipeOffset("trailing")).toBe(-152);
    expect(conversationSwipeOffset("leading")).toBe(152);
    expect(conversationSwipeOffset(null)).toBe(0);
  });

  it("mata o toque longo ao primeiro sinal de movimento", () => {
    expect(cancelsConversationLongPress(2, 3)).toBe(false);
    expect(cancelsConversationLongPress(0, 14)).toBe(true);
    expect(cancelsConversationLongPress(-9, -9)).toBe(true);
  });

  it("só engole o clique quando a linha andou", () => {
    expect(conversationSwipeMoved(0, 0)).toBe(false);
    expect(conversationSwipeMoved(-152, -152)).toBe(false);
    expect(conversationSwipeMoved(0, -30)).toBe(true);
    expect(conversationSwipeMoved(-152, -120)).toBe(true);
  });
});
