import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  boxOf,
  clearChatFilters,
  countActiveFilters,
  matchesChatFilters,
  toggleFilterValue,
  type ChatFilters,
} from "@/features/chat/lib/chat-filters";
import { indexTagsByConversation } from "@/features/chat/lib/conversation-tags";
import type { ChatConversation } from "@/features/chat/types";

const CATALOG = [
  { id: "t1", name: "VIP", color: "amber", created_at: "2026-01-01T00:00:00Z" },
  { id: "t2", name: "Urgente", color: "red", created_at: "2026-01-01T00:00:00Z" },
];

const TAGS = indexTagsByConversation(
  [
    { conversation_id: "vip", tag_id: "t1" },
    { conversation_id: "urgente", tag_id: "t2" },
  ],
  CATALOG
);

const NO_TAGS_MAP = indexTagsByConversation([], CATALOG);

function conversation(
  id: string,
  overrides: Partial<ChatConversation> = {}
): ChatConversation {
  return {
    id,
    integration_id: "int-1",
    lead_id: `lead-${id}`,
    lead_status: "em_atendimento",
    external_id: `55119999${id}`,
    contact_name: id,
    contact_phone: `55119999${id}`,
    contact_avatar_url: null,
    archived_at: null,
    removed_at: null,
    pinned_at: null,
    status: "human",
    unread_count: 0,
    last_message_at: null,
    last_message_preview: null,
    metadata: {},
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

const filters = (patch: Partial<ChatFilters> = {}): ChatFilters => ({
  ...EMPTY_FILTERS,
  ...patch,
});

describe("boxOf", () => {
  it("só `archived` muda a caixa — o resto lê a mesma lista", () => {
    expect(boxOf(filters())).toBe("active");
    expect(boxOf(filters({ status: "bot" }))).toBe("active");
    expect(boxOf(filters({ status: "resolved" }))).toBe("active");
    expect(boxOf(filters({ status: "archived" }))).toBe("archived");
  });
});

describe("matchesChatFilters — responsável", () => {
  it("sem filtro, todas passam", () => {
    expect(matchesChatFilters(conversation("a"), filters(), NO_TAGS_MAP)).toBe(true);
  });

  it("recorta pelo status da conversa", () => {
    const bot = conversation("a", { status: "bot" });
    expect(matchesChatFilters(bot, filters({ status: "bot" }), NO_TAGS_MAP)).toBe(true);
    expect(matchesChatFilters(bot, filters({ status: "human" }), NO_TAGS_MAP)).toBe(false);
  });

  it("na caixa de arquivadas o responsável não recorta nada", () => {
    // `archived` é caixa, não responsável: dentro dela valem bot, human e
    // resolved. Tratá-lo como status esvaziaria a caixa inteira.
    const bot = conversation("a", { status: "bot", archived_at: "2026-08-07T10:00:00Z" });
    expect(matchesChatFilters(bot, filters({ status: "archived" }), NO_TAGS_MAP)).toBe(true);
  });
});

describe("matchesChatFilters — não lidas", () => {
  it("só passa quem tem mensagem não lida", () => {
    const lida = conversation("a", { unread_count: 0 });
    const naoLida = conversation("b", { unread_count: 3 });
    expect(matchesChatFilters(lida, filters({ unread: true }), NO_TAGS_MAP)).toBe(false);
    expect(matchesChatFilters(naoLida, filters({ unread: true }), NO_TAGS_MAP)).toBe(true);
  });
});

describe("matchesChatFilters — etapa do funil", () => {
  it("compara com a etapa do LEAD", () => {
    const atendimento = conversation("a", { lead_status: "em_atendimento" });
    expect(
      matchesChatFilters(atendimento, filters({ stages: ["em_atendimento"] }), NO_TAGS_MAP)
    ).toBe(true);
    expect(
      matchesChatFilters(atendimento, filters({ stages: ["agendado"] }), NO_TAGS_MAP)
    ).toBe(false);
  });

  it("várias etapas valem OU — o lead está numa só", () => {
    const agendado = conversation("a", { lead_status: "agendado" });
    expect(
      matchesChatFilters(agendado, filters({ stages: ["novo", "agendado"] }), NO_TAGS_MAP)
    ).toBe(true);
  });

  it("conversa sem etapa some quando se filtra por etapa", () => {
    const semLead = conversation("a", { lead_status: null });
    expect(matchesChatFilters(semLead, filters({ stages: ["novo"] }), NO_TAGS_MAP)).toBe(false);
    // ...mas continua na lista quando não há filtro de etapa.
    expect(matchesChatFilters(semLead, filters(), NO_TAGS_MAP)).toBe(true);
  });
});

describe("matchesChatFilters — combinação", () => {
  it("entre grupos é E: IA + não lidas + etapa + etiqueta", () => {
    const alvo = conversation("vip", {
      status: "bot",
      unread_count: 2,
      lead_status: "em_atendimento",
    });
    const combinado = filters({
      status: "bot",
      unread: true,
      stages: ["em_atendimento"],
      tags: ["t1"],
    });

    expect(matchesChatFilters(alvo, combinado, TAGS)).toBe(true);

    // Basta UM critério falhar para sair da lista.
    expect(
      matchesChatFilters({ ...alvo, unread_count: 0 }, combinado, TAGS)
    ).toBe(false);
    expect(
      matchesChatFilters({ ...alvo, status: "human" }, combinado, TAGS)
    ).toBe(false);
    expect(
      matchesChatFilters({ ...alvo, lead_status: "agendado" }, combinado, TAGS)
    ).toBe(false);
    // Mesma conversa, mas etiquetada com outra coisa (`urgente` tem só `t2`).
    expect(matchesChatFilters({ ...alvo, id: "urgente" }, combinado, TAGS)).toBe(false);
  });
});

describe("countActiveFilters", () => {
  it("conta responsável, não lidas, cada etapa e cada etiqueta", () => {
    expect(countActiveFilters(filters())).toBe(0);
    // A caixa de arquivadas não é um "filtro aplicado" — é onde se está.
    expect(countActiveFilters(filters({ status: "archived" }))).toBe(0);
    expect(
      countActiveFilters(
        filters({ status: "bot", unread: true, stages: ["novo", "agendado"], tags: ["t1"] })
      )
    ).toBe(5);
  });
});

describe("clearChatFilters", () => {
  it("zera tudo e volta para Tudo", () => {
    const limpo = clearChatFilters(
      filters({ status: "bot", unread: true, stages: ["novo"], tags: ["t1"] })
    );
    expect(limpo).toEqual(EMPTY_FILTERS);
  });

  it("MANTÉM a caixa de arquivadas", () => {
    // Limpar filtros dentro das arquivadas não pode jogar o operador de volta
    // para a caixa de entrada sem ele ter pedido.
    const limpo = clearChatFilters(filters({ status: "archived", unread: true }));
    expect(limpo.status).toBe("archived");
    expect(limpo.unread).toBe(false);
  });
});

describe("toggleFilterValue", () => {
  it("liga, desliga e preserva a ordem de entrada", () => {
    expect(toggleFilterValue([], "a")).toEqual(["a"]);
    expect(toggleFilterValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFilterValue(["a", "b"], "a")).toEqual(["b"]);
  });
});
