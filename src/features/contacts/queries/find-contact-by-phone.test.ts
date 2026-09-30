import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findContactIdByPhone } from "@/features/contacts/queries/find-contact-by-phone";
import type { Database } from "@/lib/supabase/types";

// O /api/v1/context e o GET /api/v1/contacts?phone= dependem desta leitura:
// "não achei" (null) e "não consegui ler" (lança) não podem se confundir.

type Call = [method: string, ...args: unknown[]];

const fromMock = vi.fn();
const db = { from: fromMock } as unknown as SupabaseClient<Database>;

function query(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => result;
  return { builder, calls };
}

function queue(...results: { data: unknown; error: unknown }[]) {
  const queries = results.map(query);
  for (const q of queries) fromMock.mockReturnValueOnce(q.builder);
  return queries.map((q) => q.calls);
}

beforeEach(() => {
  fromMock.mockReset();
});

describe("findContactIdByPhone", () => {
  it("alias achado: devolve o dono e nem olha a coluna do contato", async () => {
    const [alias] = queue({ data: { contact_id: "c-1" }, error: null });

    await expect(findContactIdByPhone(db, "27999990000")).resolves.toBe("c-1");
    expect(fromMock.mock.calls).toEqual([["contact_phone_identities"]]);
    expect(alias).toContainEqual(["eq", "normalized_phone", "27999990000"]);
  });

  it("sem alias: procura na coluna do contato", async () => {
    const [, column] = queue({ data: null, error: null }, { data: { id: "c-2" }, error: null });

    await expect(findContactIdByPhone(db, "27999990000")).resolves.toBe("c-2");
    expect(fromMock.mock.calls).toEqual([["contact_phone_identities"], ["contacts"]]);
    expect(column).toContainEqual(["eq", "normalized_phone", "27999990000"]);
  });

  it("número sem dono: null", async () => {
    queue({ data: null, error: null }, { data: null, error: null });

    await expect(findContactIdByPhone(db, "27999990000")).resolves.toBeNull();
  });

  it("falha no alias lança, em vez de dizer 'desconhecido'", async () => {
    queue({ data: null, error: { message: "boom" } });

    await expect(findContactIdByPhone(db, "27999990000")).rejects.toThrow("contact_phone_identities");
  });

  it("falha na coluna do contato também lança", async () => {
    queue({ data: null, error: null }, { data: null, error: { message: "boom" } });

    await expect(findContactIdByPhone(db, "27999990000")).rejects.toThrow("contacts");
  });
});
