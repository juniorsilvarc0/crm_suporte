import { describe, expect, it } from "vitest";

import {
  newerThanFilter,
  olderThanFilter,
  oldestCursor,
  prependOlder,
  takePage,
} from "@/features/chat/lib/messages-page";

const msg = (id: string, created_at: string) => ({ id, created_at });

describe("olderThanFilter", () => {
  it("desempata por id quando o instante é o mesmo", () => {
    expect(olderThanFilter({ createdAt: "2026-08-01T10:00:00Z", id: "abc" })).toBe(
      "created_at.lt.2026-08-01T10:00:00Z,and(created_at.eq.2026-08-01T10:00:00Z,id.lt.abc)"
    );
  });
});

describe("newerThanFilter", () => {
  it("é o espelho do olderThanFilter, com gt no lugar de lt", () => {
    const cursor = { createdAt: "2026-08-01T10:00:00Z", id: "abc" };
    expect(newerThanFilter(cursor)).toBe(
      "created_at.gt.2026-08-01T10:00:00Z,and(created_at.eq.2026-08-01T10:00:00Z,id.gt.abc)"
    );
    // O par tem de ser complementar: nenhuma linha cai nos dois lados.
    expect(newerThanFilter(cursor)).not.toBe(olderThanFilter(cursor));
  });
});

describe("takePage", () => {
  it("com a linha excedente, corta e avisa que há mais", () => {
    const { page, hasMore } = takePage([1, 2, 3, 4], 3);
    expect(page).toEqual([1, 2, 3]);
    expect(hasMore).toBe(true);
  });

  it("exatamente no limite = acabou", () => {
    const { page, hasMore } = takePage([1, 2, 3], 3);
    expect(page).toEqual([1, 2, 3]);
    expect(hasMore).toBe(false);
  });

  it("página vazia", () => {
    expect(takePage([], 3)).toEqual({ page: [], hasMore: false });
  });
});

describe("oldestCursor", () => {
  it("aponta para a PRIMEIRA da lista — a exibição é do mais antigo para o mais novo", () => {
    const messages = [msg("a", "2026-08-01"), msg("b", "2026-08-02")];
    expect(oldestCursor(messages)).toEqual({ createdAt: "2026-08-01", id: "a" });
  });

  it("lista vazia não tem cursor", () => {
    expect(oldestCursor([])).toBeNull();
  });
});

describe("prependOlder", () => {
  const atual = [msg("c", "2026-08-03"), msg("d", "2026-08-04")];

  it("põe as antigas na frente", () => {
    const older = [msg("a", "2026-08-01"), msg("b", "2026-08-02")];
    expect(prependOlder(older, atual).map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("NÃO duplica o que o realtime já inseriu", () => {
    const older = [msg("a", "2026-08-01"), msg("c", "2026-08-03")];
    expect(prependOlder(older, atual).map((m) => m.id)).toEqual(["a", "c", "d"]);
  });

  it("página só com repetidas devolve a lista intacta (mesma referência)", () => {
    const older = [msg("c", "2026-08-03")];
    expect(prependOlder(older, atual)).toBe(atual);
  });

  it("página vazia devolve a lista intacta", () => {
    expect(prependOlder([], atual)).toBe(atual);
  });
});
