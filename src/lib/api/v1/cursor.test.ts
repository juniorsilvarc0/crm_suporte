// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  afterCursorFilter,
  cursorPage,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  encodeCursor,
  listQueryShape,
  MAX_PAGE_LIMIT,
} from "@/lib/api/v1/cursor";

const ID = "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const TS = "2026-09-29T12:34:56.123456+00:00";
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const list = z.strictObject(listQueryShape);

describe("cursor da API v1", () => {
  it("ida e volta preserva o microssegundo do banco", () => {
    const cursor = encodeCursor({ updated_at: TS, id: ID });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ updatedAt: TS, id: ID });
  });

  it("aceita os formatos de timestamp que o Postgres devolve", () => {
    for (const ts of [
      "2026-09-29T12:34:56+00:00",
      "2026-09-29T12:34:56.1Z",
      "2026-09-29T12:34:56-03",
      "2024-02-29T00:00:00+15:59",
    ]) {
      expect(decodeCursor(b64(`v1|${ts}|${ID}`)), ts).toEqual({ updatedAt: ts, id: ID });
    }
  });

  it.each([
    ["vazio", ""],
    ["fora do base64url", "abc+/="],
    ["versão desconhecida", b64(`v2|${TS}|${ID}`)],
    ["partes a mais", b64(`v1|${TS}|${ID}|x`)],
    ["id fora de UUID", b64(`v1|${TS}|1`)],
    ["timestamp com vírgula (injeção no .or())", b64(`v1|${TS},id.gt.0|${ID}`)],
    ["timestamp com parêntese", b64(`v1|2026-09-29T12:34:56)|${ID}`)],
    ["timestamp sem fuso", b64(`v1|2026-09-29T12:34:56|${ID}`)],
    ["id com filtro embutido", b64(`v1|${TS}|${ID}),or(id.gt.0`)],
    ["longo demais", "a".repeat(201)],
    // A forma passa na regex, mas o Postgres recusa: seria 503 "tente de novo".
    ["mês 13", b64(`v1|2026-13-01T00:00:00Z|${ID}`)],
    ["30 de fevereiro", b64(`v1|2026-02-30T00:00:00Z|${ID}`)],
    ["dia 00", b64(`v1|2026-09-00T00:00:00Z|${ID}`)],
    ["mês 00", b64(`v1|2026-00-10T00:00:00Z|${ID}`)],
    ["hora 24", b64(`v1|2026-09-29T24:00:00Z|${ID}`)],
    ["fuso acima de ±15:59", b64(`v1|2026-09-29T12:00:00+16:00|${ID}`)],
    ["fuso impossível", b64(`v1|2026-09-29T12:00:00+99:99|${ID}`)],
    ["ano 0000", b64(`v1|0000-01-01T00:00:00Z|${ID}`)],
  ])("recusa cursor %s", (_label, value) => {
    expect(decodeCursor(value)).toBeNull();
  });

  it("filtro keyset na mesma ordem da consulta", () => {
    expect(afterCursorFilter({ updatedAt: TS, id: ID })).toBe(
      `updated_at.gt.${TS},and(updated_at.eq.${TS},id.gt.${ID})`
    );
  });

  it("página: a linha excedente vira o próximo cursor, apontando para a última devolvida", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `${n}${ID.slice(1)}`, updated_at: `2026-09-29T00:00:0${n}Z` }));

    const page = cursorPage(rows, 2);

    expect(page.items).toEqual(rows.slice(0, 2));
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor as string)).toEqual({ updatedAt: rows[1].updated_at, id: rows[1].id });
    expect(cursorPage(rows, 3)).toEqual({ items: rows, nextCursor: null });
  });
});

describe("parâmetros comuns das listas", () => {
  it("padrões: limit 50, sem arquivados", () => {
    expect(list.parse({})).toEqual({ limit: DEFAULT_PAGE_LIMIT, include_archived: false });
  });

  it("limit de 1 a 200; fora disso é erro, nunca o padrão", () => {
    expect(list.parse({ limit: "1" }).limit).toBe(1);
    expect(list.parse({ limit: String(MAX_PAGE_LIMIT) }).limit).toBe(MAX_PAGE_LIMIT);
    for (const limit of ["0", "201", "abc", "-1", "1.5", ""]) {
      expect(list.safeParse({ limit }).success, limit).toBe(false);
    }
  });

  it("include_archived só aceita true/false", () => {
    expect(list.parse({ include_archived: "true" }).include_archived).toBe(true);
    expect(list.parse({ include_archived: "false" }).include_archived).toBe(false);
    expect(list.safeParse({ include_archived: "1" }).success).toBe(false);
  });

  it("updated_since vai para UTC (o Postgres recusa fuso acima de ±15:59)", () => {
    expect(list.parse({ updated_since: "2026-09-29T09:00:00-03:00" }).updated_since).toBe("2026-09-29T12:00:00.000Z");
    expect(list.parse({ updated_since: "2026-09-29T12:00:00+23:00" }).updated_since).toBe("2026-09-28T13:00:00.000Z");
  });

  it("updated_since antes de 1970 vira 1970 (o ano 0000 o Postgres nem aceita)", () => {
    expect(list.parse({ updated_since: "0000-01-01T00:00:00Z" }).updated_since).toBe("1970-01-01T00:00:00.000Z");
  });

  it("updated_since depois de 9999 em UTC vira o último instante de 9999 (o Postgres recusa +010000)", () => {
    expect(list.parse({ updated_since: "9999-12-31T23:59:59-23:59" }).updated_since).toBe("9999-12-31T23:59:59.999Z");
  });

  it("updated_since sem fuso ou fora da ISO é erro", () => {
    for (const value of ["2026-09-29T12:00:00", "ontem", "2026-09-29"]) {
      expect(list.safeParse({ updated_since: value }).success, value).toBe(false);
    }
  });

  it("cursor inválido é erro no campo cursor", () => {
    const result = list.safeParse({ cursor: "lixo" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["cursor"]);
  });
});
