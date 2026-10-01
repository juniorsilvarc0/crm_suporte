// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { hasEnvMock, clientMock } = vi.hoisted(() => ({
  hasEnvMock: vi.fn(),
  clientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerEnv: hasEnvMock,
  createSupabaseServerClient: clientMock,
}));

import { createHarness, has, where } from "@/app/api/v1/test-harness";
import { getRelaySigning } from "@/features/settings/queries/get-relay-signing";

const h = createHarness(clientMock);
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  hasEnvMock.mockReturnValue(true);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  error.mockRestore();
});

describe("getRelaySigning", () => {
  it("há chave: diz desde quando, lendo só a data da linha da chave de assinatura", async () => {
    h.tables.app_environment_variables = () => ({
      data: { updated_at: "2026-10-01T12:00:00+00:00" },
      error: null,
    });

    expect(await getRelaySigning()).toEqual({
      state: "configured",
      updatedAt: "2026-10-01T12:00:00+00:00",
    });

    const chain = h.lastChain("app_environment_variables");
    // Só a coluna que a tela mostra: o service_role nem tem SELECT no `secret_id`.
    expect(has(chain, "select", "updated_at")).toBe(true);
    expect(where(chain, "name", "RELAY_SIGNING_SECRET")).toBe(true);
    expect(has(chain, "maybeSingle")).toBe(true);
    // O valor não é lido aqui: nenhuma RPC do cofre é chamada.
    expect(h.rpcCalls).toEqual([]);
  });

  it("não há linha: sem chave", async () => {
    h.tables.app_environment_variables = () => ({ data: null, error: null });

    expect(await getRelaySigning()).toEqual({ state: "absent" });
    expect(error).not.toHaveBeenCalled();
  });

  it("a leitura falha: NÃO diz `sem chave`; diz que não deu para ler, e loga", async () => {
    h.tables.app_environment_variables = () => ({ data: null, error: { message: "timeout" } });

    expect(await getRelaySigning()).toEqual({ state: "unreadable" });
    expect(error).toHaveBeenCalledWith("getRelaySigning failed", expect.any(Error));
  });

  it("o client estoura: a página não cai", async () => {
    clientMock.mockImplementation(() => {
      throw new Error("Supabase env vars are missing.");
    });

    expect(await getRelaySigning()).toEqual({ state: "unreadable" });
  });

  it("sem o Supabase configurado: sem chave, sem consultar", async () => {
    hasEnvMock.mockReturnValue(false);

    expect(await getRelaySigning()).toEqual({ state: "absent" });
    expect(clientMock).not.toHaveBeenCalled();
  });
});
