// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { beginIdempotency, canonicalJson, finishIdempotency } from "@/lib/api/v1/idempotency";
import type { Database } from "@/lib/supabase/types";

const rpcClient = (result: { data: unknown; error: unknown }) =>
  ({ rpc: vi.fn(async () => result) }) as unknown as SupabaseClient<Database>;

const input = { tokenId: "t", key: "chave-0001", method: "POST", path: "/api/v1/tickets", requestHash: "h" };

describe("canonicalJson", () => {
  it("o mesmo objeto com as chaves em outra ordem dá o mesmo texto", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, { x: 0, y: 1 }] }, b: 1 })
    );
  });

  it("número não finito é erro (senão 1e400 colidiria com null)", () => {
    expect(() => canonicalJson(JSON.parse('{"n":1e400}'))).toThrow(RangeError);
    expect(() => canonicalJson(JSON.parse('{"n":-1e400}'))).toThrow(RangeError);
    expect(canonicalJson({ n: null })).toBe('{"n":null}');
  });

  it("ordem de array importa; undefined some como no JSON", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("beginIdempotency", () => {
  it.each([
    [{ outcome: "started", attempt_id: "a1" }, { outcome: "started", attemptId: "a1" }],
    [{ outcome: "replay", status: 201, body: { id: 1 } }, { outcome: "replay", status: 201, body: { id: 1 } }],
    [{ outcome: "reused" }, { outcome: "reused" }],
    [{ outcome: "in_progress" }, { outcome: "in_progress" }],
  ])("traduz %j", async (data, expected) => {
    expect(await beginIdempotency(rpcClient({ data, error: null }), input)).toEqual(expected);
  });

  it("started sem attempt_id ou outcome desconhecido é erro (nunca 'segue sem reserva')", async () => {
    await expect(beginIdempotency(rpcClient({ data: { outcome: "started" }, error: null }), input)).rejects.toThrow();
    await expect(beginIdempotency(rpcClient({ data: { outcome: "x" }, error: null }), input)).rejects.toThrow();
  });
});

describe("finishIdempotency", () => {
  const args = { tokenId: "t", key: "chave-0001", attemptId: "a1", status: 201, body: {} };

  it("P0002 (lease perdida) é false, não exceção", async () => {
    expect(await finishIdempotency(rpcClient({ data: null, error: { code: "P0002", message: "x" } }), args)).toBe(false);
  });

  it("outro erro sobe", async () => {
    await expect(
      finishIdempotency(rpcClient({ data: null, error: { code: "23514", message: "check" } }), args)
    ).rejects.toThrow();
  });
});
