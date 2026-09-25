import { describe, expect, it } from "vitest";

import { findFirstUnreadId } from "@/features/chat/lib/unread-divider";

const inbound = (id: string) => ({ id, direction: "inbound" });
const outbound = (id: string) => ({ id, direction: "outbound" });

describe("findFirstUnreadId", () => {
  it("sem não lidas, sem linha", () => {
    expect(findFirstUnreadId([inbound("a"), inbound("b")], 0)).toBeNull();
  });

  it("contador negativo ou inválido não desenha nada", () => {
    expect(findFirstUnreadId([inbound("a")], -3)).toBeNull();
    expect(findFirstUnreadId([inbound("a")], Number.NaN)).toBeNull();
  });

  it("conversa sem mensagem de entrada", () => {
    expect(findFirstUnreadId([outbound("a"), outbound("b")], 2)).toBeNull();
  });

  it("uma não lida: a linha vai na última inbound", () => {
    expect(findFirstUnreadId([inbound("a"), outbound("b"), inbound("c")], 1)).toBe("c");
  });

  it("PULA as mensagens de saída ao contar", () => {
    const messages = [inbound("a"), inbound("b"), outbound("x"), inbound("c")];
    expect(findFirstUnreadId(messages, 2)).toBe("b");
  });

  it("conta só as N últimas de entrada", () => {
    const messages = [inbound("a"), inbound("b"), inbound("c"), inbound("d")];
    expect(findFirstUnreadId(messages, 3)).toBe("b");
  });

  it("contador maior que a janela: linha na inbound mais antiga carregada", () => {
    // 150 não lidas, mas só 2 inbound vieram — a fronteira é mais antiga que a
    // janela, então tudo que está na tela é não lido.
    const messages = [outbound("x"), inbound("a"), inbound("b")];
    expect(findFirstUnreadId(messages, 150)).toBe("a");
  });

  it("contador igual ao total de inbound", () => {
    const messages = [inbound("a"), outbound("x"), inbound("b")];
    expect(findFirstUnreadId(messages, 2)).toBe("a");
  });

  it("lista vazia", () => {
    expect(findFirstUnreadId([], 5)).toBeNull();
  });

  it("a saída é um ID, não um índice — carregar mensagens antigas não move a linha", () => {
    const janela = [inbound("a"), inbound("b"), inbound("c")];
    const ancora = findFirstUnreadId(janela, 2);
    const comAntigas = [inbound("z0"), inbound("z1"), ...janela];
    // O consumidor guarda a âncora; o id continua apontando para a mesma bolha.
    expect(ancora).toBe("b");
    expect(comAntigas.some((m) => m.id === ancora)).toBe(true);
  });
});
