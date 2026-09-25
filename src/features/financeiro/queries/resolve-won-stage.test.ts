import { describe, expect, it, vi } from "vitest";

import { resolveWonStage } from "@/features/financeiro/queries/resolve-won-stage";

type Result = {
  data: { key: string; position: number } | null;
  error: { message: string } | null;
};

// Mock mínimo da cadeia usada:
//   board_columns.select().eq().order().limit().maybeSingle()
function makeClient(result: Result | (() => never)) {
  const maybeSingle = vi.fn(async () => {
    if (typeof result === "function") result();
    return result as Result;
  });
  const limit = vi.fn(() => ({ maybeSingle }));
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table !== "board_columns") throw new Error(`tabela inesperada: ${table}`);
    return { select };
  });
  return { client: { from } as never, from, select, eq, order, limit };
}

describe("resolveWonStage", () => {
  it("devolve a primeira etapa de ganho por posição", async () => {
    const { client, eq, order } = makeClient({
      data: { key: "cliente", position: 7 },
      error: null,
    });

    await expect(resolveWonStage(client)).resolves.toBe("cliente");
    expect(eq).toHaveBeenCalledWith("stage_type", "won");
    expect(order).toHaveBeenCalledWith("position");
  });

  it("board sem etapa de ganho devolve null, sem cair em literal", async () => {
    const { client } = makeClient({ data: null, error: null });
    await expect(resolveWonStage(client)).resolves.toBeNull();
  });

  it("erro do Supabase loga e devolve null em vez de derrubar a venda", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    await expect(resolveWonStage(client)).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("exceção também vira null", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient(() => {
      throw new Error("rede caiu");
    });

    await expect(resolveWonStage(client)).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
