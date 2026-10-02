import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import ConfiguracoesPage from "@/app/(dashboard)/app/configuracoes/page";

beforeEach(() => {
  redirectMock.mockClear();
});

describe("/app/configuracoes (endereço antigo)", () => {
  it("leva à aba Variáveis de Integrações, a que esta página abria por padrão", () => {
    expect(() => ConfiguracoesPage()).toThrow("NEXT_REDIRECT /app/conexao?aba=variaveis");
    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/app/conexao?aba=variaveis");
  });
});
