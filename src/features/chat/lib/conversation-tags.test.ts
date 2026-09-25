import { describe, expect, it } from "vitest";

import {
  conversationMatchesTagFilter,
  countConversationsByTag,
  indexTagsByConversation,
  mergeTagAssignment,
  removeTagEverywhere,
} from "@/features/chat/lib/conversation-tags";
import type { Tag } from "@/features/tags/types";

const tag = (id: string, name: string): Tag => ({
  id,
  name,
  color: "violet",
  created_at: "2026-08-08T12:00:00.000Z",
});

const NOVO = tag("t1", "Novo cliente");
const RESOLVER = tag("t2", "Resolver");
const ATRASADO = tag("t3", "Atrasado");
const CATALOG = [NOVO, RESOLVER, ATRASADO];

describe("indexTagsByConversation", () => {
  it("agrupa vínculos por conversa", () => {
    const map = indexTagsByConversation(
      [
        { conversation_id: "c1", tag_id: "t1" },
        { conversation_id: "c1", tag_id: "t2" },
        { conversation_id: "c2", tag_id: "t2" },
      ],
      CATALOG
    );
    expect(map.get("c1")).toEqual([NOVO, RESOLVER]);
    expect(map.get("c2")).toEqual([RESOLVER]);
  });

  it("ordena por nome para o chip não trocar de lugar entre cargas", () => {
    const map = indexTagsByConversation(
      [
        { conversation_id: "c1", tag_id: "t2" },
        { conversation_id: "c1", tag_id: "t3" },
        { conversation_id: "c1", tag_id: "t1" },
      ],
      CATALOG
    );
    expect(map.get("c1")?.map((t) => t.name)).toEqual([
      "Atrasado",
      "Novo cliente",
      "Resolver",
    ]);
  });

  it("ignora vínculo órfão de etiqueta apagada", () => {
    const map = indexTagsByConversation(
      [
        { conversation_id: "c1", tag_id: "sumiu" },
        { conversation_id: "c1", tag_id: "t1" },
      ],
      CATALOG
    );
    expect(map.get("c1")).toEqual([NOVO]);
  });

  it("conversa sem vínculo não entra no mapa", () => {
    const map = indexTagsByConversation([], CATALOG);
    expect(map.get("c1")).toBeUndefined();
    expect(map.size).toBe(0);
  });
});

describe("mergeTagAssignment", () => {
  const base = indexTagsByConversation(
    [
      { conversation_id: "c1", tag_id: "t1" },
      { conversation_id: "c2", tag_id: "t2" },
    ],
    CATALOG
  );

  it("etiqueta a conversa", () => {
    const next = mergeTagAssignment(base, "c1", RESOLVER, true);
    expect(next.get("c1")).toEqual([NOVO, RESOLVER]);
  });

  it("desetiqueta a conversa", () => {
    const next = mergeTagAssignment(base, "c1", NOVO, false);
    expect(next.get("c1")).toBeUndefined();
  });

  it("etiqueta a primeira etiqueta de uma conversa que não tinha nenhuma", () => {
    const next = mergeTagAssignment(base, "c9", NOVO, true);
    expect(next.get("c9")).toEqual([NOVO]);
  });

  it("⚠️ preserva a referência das OUTRAS conversas — é o que salva o memo", () => {
    const antes = base.get("c2");
    const next = mergeTagAssignment(base, "c1", RESOLVER, true);
    expect(next.get("c2")).toBe(antes);
  });

  it("devolve o MESMO mapa quando nada muda", () => {
    // Etiquetar o que já está etiquetado…
    expect(mergeTagAssignment(base, "c1", NOVO, true)).toBe(base);
    // …e tirar o que não está.
    expect(mergeTagAssignment(base, "c1", RESOLVER, false)).toBe(base);
    // …inclusive numa conversa fora do mapa.
    expect(mergeTagAssignment(base, "c9", NOVO, false)).toBe(base);
  });

  it("mantém a ordem alfabética ao acrescentar", () => {
    const next = mergeTagAssignment(base, "c1", ATRASADO, true);
    expect(next.get("c1")?.map((t) => t.name)).toEqual(["Atrasado", "Novo cliente"]);
  });
});

describe("removeTagEverywhere", () => {
  const base = indexTagsByConversation(
    [
      { conversation_id: "c1", tag_id: "t1" },
      { conversation_id: "c1", tag_id: "t2" },
      { conversation_id: "c2", tag_id: "t2" },
    ],
    CATALOG
  );

  it("tira a etiqueta de todas as conversas", () => {
    const next = removeTagEverywhere(base, "t2");
    expect(next.get("c1")).toEqual([NOVO]);
    expect(next.get("c2")).toBeUndefined();
  });

  it("preserva a referência de quem não tinha a etiqueta", () => {
    const map = indexTagsByConversation(
      [
        { conversation_id: "c1", tag_id: "t1" },
        { conversation_id: "c2", tag_id: "t2" },
      ],
      CATALOG
    );
    const antes = map.get("c1");
    expect(removeTagEverywhere(map, "t2").get("c1")).toBe(antes);
  });

  it("devolve o mesmo mapa quando a etiqueta não estava em lugar nenhum", () => {
    expect(removeTagEverywhere(base, "inexistente")).toBe(base);
  });
});

describe("conversationMatchesTagFilter", () => {
  const base = indexTagsByConversation(
    [{ conversation_id: "c1", tag_id: "t1" }],
    CATALOG
  );

  it("sem filtro, todas passam", () => {
    expect(conversationMatchesTagFilter(base, "c1", [])).toBe(true);
    expect(conversationMatchesTagFilter(base, "c9", [])).toBe(true);
  });

  it("com filtro, só quem tem a etiqueta passa", () => {
    expect(conversationMatchesTagFilter(base, "c1", ["t1"])).toBe(true);
    expect(conversationMatchesTagFilter(base, "c1", ["t2"])).toBe(false);
    expect(conversationMatchesTagFilter(base, "c9", ["t1"])).toBe(false);
  });

  it("várias etiquetas valem OU: basta ter uma delas", () => {
    // Exigir as duas devolveria vazio — a conversa só tem `t1`.
    expect(conversationMatchesTagFilter(base, "c1", ["t1", "t2"])).toBe(true);
    expect(conversationMatchesTagFilter(base, "c1", ["t2", "t3"])).toBe(false);
  });
});

describe("countConversationsByTag", () => {
  it("conta conversas por etiqueta", () => {
    const map = indexTagsByConversation(
      [
        { conversation_id: "c1", tag_id: "t1" },
        { conversation_id: "c1", tag_id: "t2" },
        { conversation_id: "c2", tag_id: "t2" },
      ],
      CATALOG
    );
    const counts = countConversationsByTag(map);
    expect(counts.get("t1")).toBe(1);
    expect(counts.get("t2")).toBe(2);
    expect(counts.get("t3")).toBeUndefined();
  });
});
