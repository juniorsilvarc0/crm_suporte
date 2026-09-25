import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerEnv: () => true,
  createSupabaseServerClient: () => ({ rpc: rpcMock }),
}));

import {
  getRuntimeEnvironmentVariable,
  getTranscriptionModelConfig,
} from "@/features/settings/lib/get-runtime-environment";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TESTE_RUNTIME;
  delete process.env.OPENAI_TRANSCRIPTION_MODEL;
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("getRuntimeEnvironmentVariable", () => {
  it("prioriza o valor gerenciado no cofre", async () => {
    process.env.TESTE_RUNTIME = "servidor";
    rpcMock.mockResolvedValue({ data: "cofre", error: null });

    await expect(getRuntimeEnvironmentVariable("TESTE_RUNTIME")).resolves.toEqual({
      value: "cofre",
      source: "vault",
    });
  });

  it("mantém o ambiente da VPS como fallback", async () => {
    process.env.TESTE_RUNTIME = "servidor";

    await expect(getRuntimeEnvironmentVariable("TESTE_RUNTIME")).resolves.toEqual({
      value: "servidor",
      source: "environment",
    });
  });
});

describe("getTranscriptionModelConfig", () => {
  it("usa whisper-1 quando não existe configuração válida", async () => {
    process.env.OPENAI_TRANSCRIPTION_MODEL = "modelo-inexistente";

    await expect(getTranscriptionModelConfig()).resolves.toEqual({
      value: "whisper-1",
      source: "default",
    });
  });

  it("aceita um modelo compatível vindo do cofre", async () => {
    rpcMock.mockResolvedValue({ data: "gpt-4o-transcribe", error: null });

    await expect(getTranscriptionModelConfig()).resolves.toEqual({
      value: "gpt-4o-transcribe",
      source: "vault",
    });
  });
});
