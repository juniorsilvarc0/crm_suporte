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
  it("lê o catálogo inteiro do cofre numa chamada", async () => {
    vault([{ name: "OPENAI_API_KEY", value: "sk-cofre" }]);

    await expect(getRuntimeEnvironmentVariable("OPENAI_API_KEY")).resolves.toEqual({
      value: "sk-cofre",
      source: "vault",
    });
    expect(rpcMock).toHaveBeenCalledWith("get_app_environment_variables", {
      p_names: ["OPENAI_API_KEY", "OPENAI_TRANSCRIPTION_MODEL", "RELAY_SIGNING_SECRET"],
    });
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
    vault([{ name: "RELAY_SIGNING_SECRET", value: "do-cache" }]);
    await getRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET");
    one("do-cofre-agora");

    await expect(readRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).resolves.toBe("do-cofre-agora");
    // O cache segue com o que tinha: a leitura direta não o toca.
    await expect(getRuntimeEnvironmentVariable("RELAY_SIGNING_SECRET")).resolves.toEqual({
      value: "do-cache",
      source: "vault",
    });
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
