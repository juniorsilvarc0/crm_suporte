import { describe, expect, it } from "vitest";

import {
  compareByLastMessage,
  conversationMatchesBox,
  mergeConversationRealtimeUpdate,
  mergeConversationUpdate,
} from "@/features/chat/lib/conversation-list";
import type { ChatConversation } from "@/features/chat/types";

function conversation(
  id: string,
  overrides: Partial<ChatConversation> = {}
): ChatConversation {
  return {
    id,
    integration_id: "int-1",
    contact_id: `contato-${id}`,
    external_id: `551199999${id}`,
    contact_name: `Contato ${id}`,
    contact_phone: `551199999${id}`,
    contact_avatar_url: null,
    archived_at: null,
    removed_at: null,
    pinned_at: null,
    status: "human",
    active_ticket_id: null,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: null,
    metadata: {},
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

const ids = (list: ChatConversation[]) => list.map((c) => c.id);

describe("compareByLastMessage", () => {
  it("mais recente primeiro", () => {
    const antiga = conversation("a", { last_message_at: "2026-08-01T10:00:00Z" });
    const nova = conversation("b", { last_message_at: "2026-08-08T10:00:00Z" });
    expect([antiga, nova].sort(compareByLastMessage).map((c) => c.id)).toEqual([
      "b",
      "a",
    ]);
  });

  // Bate com `nullsFirst: false` da consulta inicial. Se divergir, a lista muda
  // de ordem sozinha no primeiro evento do realtime.
  it("conversa sem data vai para o fim", () => {
    const semData = conversation("a");
    const comData = conversation("b", { last_message_at: "2026-08-01T10:00:00Z" });
    expect([semData, comData].sort(compareByLastMessage).map((c) => c.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("data inválida conta como sem data", () => {
    const quebrada = conversation("a", { last_message_at: "não é data" });
    const boa = conversation("b", { last_message_at: "2026-08-01T10:00:00Z" });
    expect([quebrada, boa].sort(compareByLastMessage).map((c) => c.id)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("conversationMatchesBox", () => {
  it("arquivada só aparece na caixa de arquivadas", () => {
    const arquivada = conversation("a", { archived_at: "2026-08-07T10:00:00Z" });
    expect(conversationMatchesBox(arquivada, "archived")).toBe(true);
    expect(conversationMatchesBox(arquivada, "active")).toBe(false);
  });

  it("ativa nunca aparece na caixa de arquivadas", () => {
    expect(conversationMatchesBox(conversation("a"), "archived")).toBe(false);
  });

  it("o STATUS não decide pertencimento à caixa", () => {
    // A regra que mudou: `bot` e `human` continuam na lista carregada, e o chip
    // de responsável recorta na hora de desenhar. Sem isto, a conversa que a IA
    // devolve ao humano some da lista em vez de mudar de grupo.
    const bot = conversation("a", { status: "bot" });
    const human = conversation("b", { status: "human" });
    expect(conversationMatchesBox(bot, "active")).toBe(true);
    expect(conversationMatchesBox(human, "active")).toBe(true);
  });

  it("conversa removida não aparece em nenhuma caixa", () => {
    const removida = conversation("a", { removed_at: "2026-08-09T10:00:00Z" });
    expect(conversationMatchesBox(removida, "active")).toBe(false);
    expect(conversationMatchesBox(removida, "archived")).toBe(false);
  });
});

describe("mergeConversationUpdate", () => {
  const lista = [
    conversation("a", { last_message_at: "2026-08-08T10:00:00Z" }),
    conversation("b", { last_message_at: "2026-08-07T10:00:00Z" }),
    conversation("c", { last_message_at: "2026-08-05T10:00:00Z" }),
  ];

  // O bug que originou este arquivo.
  it("mensagem nova faz a conversa subir para o topo", () => {
    const next = mergeConversationUpdate(
      lista,
      { id: "c", last_message_at: "2026-08-08T18:00:00Z", unread_count: 2 },
      "active"
    );
    expect(ids(next)).toEqual(["c", "a", "b"]);
    expect(next[0].unread_count).toBe(2);
  });

  // O canal do realtime não tem filtro: chega UPDATE das 407 conversas, e cada
  // mensagem recebida gera dois eventos. Array novo aqui re-renderiza a tela.
  it("conversa fora da lista devolve a MESMA referência", () => {
    const next = mergeConversationUpdate(lista, { id: "zzz", unread_count: 9 }, "active");
    expect(next).toBe(lista);
  });

  it("update sem mudar a hora não reordena", () => {
    const next = mergeConversationUpdate(lista, { id: "b", unread_count: 5 }, "active");
    expect(ids(next)).toEqual(["a", "b", "c"]);
    expect(next).not.toBe(lista);
    expect(next[1].unread_count).toBe(5);
  });

  it("arquivar tira da lista de ativas", () => {
    const next = mergeConversationUpdate(
      lista,
      { id: "b", archived_at: "2026-08-08T12:00:00Z" },
      "active"
    );
    expect(ids(next)).toEqual(["a", "c"]);
  });

  it("desarquivar tira da lista de arquivadas", () => {
    const arquivadas = [conversation("a", { archived_at: "2026-08-07T10:00:00Z" })];
    expect(
      mergeConversationUpdate(arquivadas, { id: "a", archived_at: null }, "archived")
    ).toEqual([]);
  });

  it("mudar de status NÃO tira da caixa — só muda o grupo do chip", () => {
    // Regra invertida de propósito quando o filtro de responsável virou filtro
    // de render: a conversa que a IA devolve ao humano precisa continuar
    // carregada, senão ela some da tela em vez de mudar de grupo — e voltaria
    // só com uma consulta nova.
    const ativas = [conversation("a", { status: "human" })];
    const next = mergeConversationUpdate(ativas, { id: "a", status: "resolved" }, "active");

    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("resolved");
  });

  it("não muda a lista original", () => {
    const original = [...lista];
    mergeConversationUpdate(lista, { id: "c", last_message_at: "2026-08-09T10:00:00Z" }, "active");
    expect(lista).toEqual(original);
  });

  it("conversa sem data que recebe mensagem sai do fim", () => {
    const comSemData = [
      conversation("a", { last_message_at: "2026-08-08T10:00:00Z" }),
      conversation("b"),
    ];
    const next = mergeConversationUpdate(
      comSemData,
      { id: "b", last_message_at: "2026-08-08T20:00:00Z" },
      "active"
    );
    expect(ids(next)).toEqual(["b", "a"]);
  });
});

describe("mergeConversationRealtimeUpdate", () => {
  it("recoloca conversa removida quando a pessoa volta", () => {
    const fixada = conversation("fixada", {
      pinned_at: "2026-08-09T08:00:00Z",
      last_message_at: "2026-08-01T10:00:00Z",
    });
    const restaurada = conversation("retorno", {
      last_message_at: "2026-08-09T12:00:00Z",
      removed_at: null,
    });

    const next = mergeConversationRealtimeUpdate(
      [fixada],
      restaurada,
      "active",
      ""
    );

    expect(ids(next)).toEqual(["fixada", "retorno"]);
    expect(next[1].contact_id).toBe("contato-retorno");
  });

  it("payload parcial de conversa ausente preserva a referência", () => {
    const list = [conversation("a")];
    expect(
      mergeConversationRealtimeUpdate(list, { id: "fora", unread_count: 1 }, "active", "")
    ).toBe(list);
  });

  it("não recoloca conversa que segue removida ou não casa com a busca", () => {
    const list = [conversation("a")];
    const removed = conversation("removida", {
      removed_at: "2026-08-09T12:00:00Z",
    });
    const other = conversation("outra", { contact_name: "Maria" });

    expect(mergeConversationRealtimeUpdate(list, removed, "active", "")).toBe(list);
    expect(mergeConversationRealtimeUpdate(list, other, "active", "João")).toBe(list);
  });
});

describe("fixar conversa", () => {
  const FIXADA_CEDO = "2026-08-08T10:00:00Z";
  const FIXADA_TARDE = "2026-08-08T18:00:00Z";

  it("fixada fica acima de conversa com mensagem mais nova", () => {
    const fixada = conversation("fixada", {
      pinned_at: FIXADA_CEDO,
      last_message_at: "2026-08-01T10:00:00Z",
    });
    const recente = conversation("recente", {
      last_message_at: "2026-08-08T23:00:00Z",
    });
    expect(ids([recente, fixada].sort(compareByLastMessage))).toEqual([
      "fixada",
      "recente",
    ]);
  });

  it("entre fixadas, a fixada mais recente vem antes", () => {
    const cedo = conversation("cedo", { pinned_at: FIXADA_CEDO });
    const tarde = conversation("tarde", { pinned_at: FIXADA_TARDE });
    expect(ids([cedo, tarde].sort(compareByLastMessage))).toEqual([
      "tarde",
      "cedo",
    ]);
  });

  it("fixadas com a MESMA data caem no desempate por mensagem", () => {
    const antiga = conversation("antiga", {
      pinned_at: FIXADA_CEDO,
      last_message_at: "2026-08-01T10:00:00Z",
    });
    const nova = conversation("nova", {
      pinned_at: FIXADA_CEDO,
      last_message_at: "2026-08-08T10:00:00Z",
    });
    expect(ids([antiga, nova].sort(compareByLastMessage))).toEqual([
      "nova",
      "antiga",
    ]);
  });

  it("data de fixação inválida conta como solta", () => {
    const quebrada = conversation("quebrada", { pinned_at: "não é data" });
    const solta = conversation("solta", {
      last_message_at: "2026-08-08T10:00:00Z",
    });
    expect(ids([quebrada, solta].sort(compareByLastMessage))).toEqual([
      "solta",
      "quebrada",
    ]);
  });

  it("⚠️ fixar reordena a lista na hora, sem esperar recarga", () => {
    const lista = [
      conversation("a", { last_message_at: "2026-08-08T23:00:00Z" }),
      conversation("b", { last_message_at: "2026-08-08T22:00:00Z" }),
      conversation("c", { last_message_at: "2026-08-08T21:00:00Z" }),
    ];
    // Fixar não mexe em `last_message_at`; sem comparar `pinned_at` no merge, a
    // conversa ficaria parada onde estava.
    const depois = mergeConversationUpdate(
      lista,
      { id: "c", pinned_at: FIXADA_TARDE },
      "active"
    );
    expect(ids(depois)).toEqual(["c", "a", "b"]);
  });

  it("desafixar devolve a conversa ao lugar dela", () => {
    const lista = [
      conversation("fixada", {
        pinned_at: FIXADA_TARDE,
        last_message_at: "2026-08-01T10:00:00Z",
      }),
      conversation("recente", { last_message_at: "2026-08-08T23:00:00Z" }),
    ];
    const depois = mergeConversationUpdate(
      lista,
      { id: "fixada", pinned_at: null },
      "active"
    );
    expect(ids(depois)).toEqual(["recente", "fixada"]);
  });
});
