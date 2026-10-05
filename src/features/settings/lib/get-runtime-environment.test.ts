import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, hasEnvMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), hasEnvMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerEnv: hasEnvMock,
  createSupabaseServerClient: () => ({ rpc: rpcMock }),
}));

import {
  getRuntimeEnvironmentVariable,
  getTranscriptionModelConfig,
  invalidateRuntimeEnvironmentCache,
  readRuntimeEnvironmentVariable,
  RuntimeEnvironmentUnavailableError,
} from "@/features/settings/lib/get-runtime-environment";

function vault(rows: { name: string; value: string }[]) {
  rpcMock.mockResolvedValue({ data: rows, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasEnvMock.mockReturnValue(true);
  invalidateRuntimeEnvironmentCache();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_TRANSCRIPTION_MODEL;
  vault([]);
});

describe("getRuntimeEnvironmentVariable", () => {
  it("lê do cofre, numa chamada, o que vai para o cache: o catálogo SEM a chave de assinatura", async () => {
    vault([{ name: "OPENAI_API_KEY", value: "sk-cofre" }]);

    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toEqual({
      value: "sk-cofre",
      source: "vault",
    });
    // A chave de assinatura do relay não é pedida: ela não mora na memória da réplica.
    expect(rpcMock.mock.calls).toEqual([
      [
        "get_app_environment_variables",
        { p_names: ["OPENAI_API_KEY", "OPENAI_TRANSCRIPTION_MODEL", "CUSTOMER_SOURCE_URL", "CUSTOMER_SOURCE_TOKEN"] },
      ],
    ]);
  });

  it("a chave de assinatura não se lê pelo cache, nem que o cofre a devolva sem ter sido pedida", async () => {
    vault([
      { name: "RELAY_SIGNING_SECRET", value: "chave-que-veio-de-carona" },
      { name: "OPENAI_API_KEY", value: "sk-cofre" },
    ]);

    // @ts-expect-error o tipo recusa o nome: a chave só se lê por readRuntimeEnvironmentVariable.
    const fromCache = getRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET");

    // Três travas: o TIPO (acima), a consulta (o nome não é pedido ao cofre) e o
    // cache (uma linha que viesse de carona não entra nele).
    await expect(fromCache).resolves.toEqual({ value: null, source: "none" });
    expect(rpcMock.mock.calls[0][1].p_names).not.toContain("RELAY_SIGNING_SECRET");
    // O resto da mesma leitura entrou normalmente.
    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toEqual({
      value: "sk-cofre",
      source: "vault",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("ignora a variável de ambiente: credencial não mora no env", async () => {
    process.env.OPENAI_API_KEY = "sk-do-servidor";

    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toEqual({
      value: null,
      source: "none",
    });
  });

  it("falha fechada quando o cofre não responde", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "timeout" } });

    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).rejects.toBeInstanceOf(
      RuntimeEnvironmentUnavailableError
    );
  });

  it("reaproveita a leitura por 60 s e relê depois de invalidar", async () => {
    vault([{ name: "OPENAI_API_KEY", value: "sk-1" }]);
    await getRuntimeEnvironmentVariable("OPENAI_API_KEY");
    vault([{ name: "OPENAI_API_KEY", value: "sk-2" }]);

    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toMatchObject({
      value: "sk-1",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    invalidateRuntimeEnvironmentCache();
    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toMatchObject({
      value: "sk-2",
    });
  });

  it("leitura que começou antes de uma gravação não repõe o valor antigo no cache", async () => {
    let finishRead!: (value: unknown) => void;
    rpcMock.mockReturnValueOnce(new Promise((resolve) => (finishRead = resolve)));
    const inFlight = getRuntimeEnvironmentVariable("OPENAI_API_KEY");

    // O admin troca a chave enquanto a leitura está em voo.
    invalidateRuntimeEnvironmentCache();
    finishRead({ data: [{ name: "OPENAI_API_KEY", value: "sk-antiga" }], error: null });
    await inFlight;

    vault([{ name: "OPENAI_API_KEY", value: "sk-nova" }]);
    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toMatchObject({
      value: "sk-nova",
    });
  });
});

describe("getTranscriptionModelConfig", () => {
  it("usa whisper-1 quando não existe configuração válida", async () => {
    vault([{ name: "OPENAI_TRANSCRIPTION_MODEL", value: "modelo-inexistente" }]);

    await expect(getTranscriptionModelConfig()).resolves.toEqual({
      value: "whisper-1",
      source: "default",
    });
  });

  it("aceita um modelo compatível vindo do cofre", async () => {
    vault([{ name: "OPENAI_TRANSCRIPTION_MODEL", value: "gpt-4o-transcribe" }]);

    await expect(getTranscriptionModelConfig()).resolves.toEqual({
      value: "gpt-4o-transcribe",
      source: "vault",
    });
  });
});

describe("readRuntimeEnvironmentVariable", () => {
  const one = (value: unknown) => rpcMock.mockResolvedValue({ data: value, error: null });

  it("lê UMA variável pelo nome, direto do cofre", async () => {
    one("chave-de-assinatura");

    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).resolves.toBe("chave-de-assinatura");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("get_app_environment_variable", { p_name: "RELAY_SIGNING_SECRET" });
  });

  it("sem cache: cada chamada vai ao cofre, e a troca vale na leitura seguinte", async () => {
    one("chave-1");
    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).resolves.toBe("chave-1");
    one("chave-2");
    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).resolves.toBe("chave-2");
    one(null);
    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).resolves.toBeNull();

    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("não lê nem alimenta o cache do catálogo", async () => {
    vault([{ name: "OPENAI_API_KEY", value: "do-cache" }]);
    await getRuntimeEnvironmentVariable("OPENAI_API_KEY");
    one("do-cofre-agora");

    await expect(readRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toBe("do-cofre-agora");
    // O cache segue com o que tinha: a leitura direta não o toca.
    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toEqual({
      value: "do-cache",
      source: "vault",
    });
    expect(rpcMock.mock.calls.map(([name]) => name)).toEqual([
      "get_app_environment_variables",
      "get_app_environment_variable",
    ]);
  });

  it.each([
    ["ausente", null],
    ["vazia", ""],
    ["de outro tipo", 42],
  ])("variável %s é `sem valor`", async (_label, value) => {
    one(value);

    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).resolves.toBeNull();
  });

  it("falha fechada quando o cofre não responde: não é o mesmo que `sem valor`", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "timeout" } });

    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).rejects.toThrow(
      new RuntimeEnvironmentUnavailableError("timeout").message
    );
    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).rejects.toBeInstanceOf(
      RuntimeEnvironmentUnavailableError
    );
  });

  it("sem Supabase configurado: falha fechada, sem tentar ler", async () => {
    hasEnvMock.mockReturnValue(false);

    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).rejects.toBeInstanceOf(
      RuntimeEnvironmentUnavailableError
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
