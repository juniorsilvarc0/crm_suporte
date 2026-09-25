import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerEnv: () => true,
  createSupabaseServerClient: () => ({ rpc: rpcMock }),
}));

import {
  getRuntimeEnvironmentVariable,
  getTranscriptionModelConfig,
  invalidateRuntimeEnvironmentCache,
  RuntimeEnvironmentUnavailableError,
} from "@/features/settings/lib/get-runtime-environment";

function vault(rows: { name: string; value: string }[]) {
  rpcMock.mockResolvedValue({ data: rows, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
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
      p_names: ["OPENAI_API_KEY", "OPENAI_TRANSCRIPTION_MODEL"],
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
