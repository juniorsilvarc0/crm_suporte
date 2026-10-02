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

import { createHarness, has, type Call } from "@/app/api/v1/test-harness";
import { getEnvironmentVariables } from "@/features/settings/queries/get-environment-variables";

const h = createHarness(clientMock);
let error: ReturnType<typeof vi.spyOn>;

const row = (name: string) => ({
  id: `id-${name}`,
  name,
  created_at: "2026-09-30T10:00:00+00:00",
  updated_at: "2026-10-01T12:00:00+00:00",
});

/** Um banco de mentira que APLICA os `.neq("name", …)` da consulta às linhas. */
function table(names: string[]) {
  h.tables.app_environment_variables = (calls: Call[]) => {
    const hidden = calls.filter(([method, column]) => method === "neq" && column === "name").map(([, , value]) => value);
    return { data: names.filter((name) => !hidden.includes(name)).map(row), error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  hasEnvMock.mockReturnValue(true);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  error.mockRestore();
});

describe("getEnvironmentVariables", () => {
  it("lista o que está no cofre, sem o modelo de transcrição e sem a chave de assinatura", async () => {
    table(["OPENAI_API_KEY", "OPENAI_TRANSCRIPTION_MODEL", "RELAY_SIGNING_SECRET"]);

    expect(await getEnvironmentVariables()).toEqual([
      {
        id: "id-OPENAI_API_KEY",
        name: "OPENAI_API_KEY",
        source: "vault",
        createdAt: "2026-09-30T10:00:00+00:00",
        updatedAt: "2026-10-01T12:00:00+00:00",
      },
    ]);

    const chain = h.lastChain("app_environment_variables");
    // O modelo tem seletor próprio; a chave de assinatura, o bloco em Agente de IA.
    expect(has(chain, "neq", "name", "OPENAI_TRANSCRIPTION_MODEL")).toBe(true);
    expect(has(chain, "neq", "name", "RELAY_SIGNING_SECRET")).toBe(true);
    // Só metadados: o valor nunca é selecionado.
    expect(has(chain, "select", "id, name, created_at, updated_at")).toBe(true);
  });

  it("variável antiga de fora do catálogo continua aparecendo, para poder ser removida", async () => {
    table(["MINHA_CHAVE", "OPENAI_API_KEY"]);

    expect((await getEnvironmentVariables()).map((variable) => variable.name)).toEqual([
      "MINHA_CHAVE",
      "OPENAI_API_KEY",
    ]);
  });

  it("a lista sai em ordem de nome, pedida ao banco e garantida na saída", async () => {
    // O banco de mentira devolve fora de ordem: a saída não depende dele.
    table(["ZETA", "OPENAI_API_KEY", "ALFA"]);

    expect((await getEnvironmentVariables()).map((variable) => variable.name)).toEqual([
      "ALFA",
      "OPENAI_API_KEY",
      "ZETA",
    ]);
    expect(has(h.lastChain("app_environment_variables"), "order", "name", { ascending: true })).toBe(true);
  });

  it("a leitura falha: lista vazia e log, sem derrubar a página", async () => {
    h.tables.app_environment_variables = () => ({ data: null, error: { message: "timeout" } });

    expect(await getEnvironmentVariables()).toEqual([]);
    expect(error).toHaveBeenCalledWith("getEnvironmentVariables failed", "timeout");
  });

  it("sem o Supabase configurado: lista vazia, sem consultar", async () => {
    hasEnvMock.mockReturnValue(false);

    expect(await getEnvironmentVariables()).toEqual([]);
    expect(clientMock).not.toHaveBeenCalled();
  });
});
