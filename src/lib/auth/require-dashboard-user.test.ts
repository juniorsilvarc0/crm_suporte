import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocka só as fronteiras (cookie, verificação do JWT e leitura do usuário) para
// o guard rodar de verdade — é ele que decide quem grava resposta rápida.
const { cookiesMock, verifyMock, getAppUserMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  verifyMock: vi.fn(),
  getAppUserMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/auth/session", () => ({
  AUTH_COOKIE: "crm-suporte-session",
  verifySessionToken: verifyMock,
}));
vi.mock("@/features/settings/queries/get-app-users", () => ({
  getAppUser: getAppUserMock,
}));

import {
  requireDashboardTracking,
  requireDashboardUser,
} from "@/lib/auth/require-dashboard-session";

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.mockResolvedValue({ get: () => ({ value: "token" }) });
  verifyMock.mockResolvedValue({ id: "user-1" });
});

describe("requireDashboardUser", () => {
  it("libera um MEMBRO ativo", async () => {
    // O ponto da mudança: gerenciar resposta rápida deixou de ser exclusivo do
    // administrador. Se este teste voltar a falhar, a regra regrediu.
    getAppUserMock.mockResolvedValue({ id: "user-1", role: "member", is_active: true });

    const result = await requireDashboardUser();

    expect("viewer" in result).toBe(true);
    expect("viewer" in result && result.viewer.id).toBe("user-1");
  });

  it("libera um administrador ativo", async () => {
    getAppUserMock.mockResolvedValue({ id: "user-1", role: "admin", is_active: true });

    expect("viewer" in (await requireDashboardUser())).toBe(true);
  });

  it("recusa tráfego pago fora do rastreamento", async () => {
    getAppUserMock.mockResolvedValue({
      id: "user-1",
      role: "paid_traffic",
      is_active: true,
    });

    const result = await requireDashboardUser();

    expect("error" in result && result.error.status).toBe(403);
  });

  it("recusa usuário desativado, mesmo com cookie válido", async () => {
    // O papel vem do BANCO, não do JWT: desativar tem efeito imediato.
    getAppUserMock.mockResolvedValue({ id: "user-1", role: "admin", is_active: false });

    const result = await requireDashboardUser();

    expect("error" in result).toBe(true);
    expect("error" in result && result.error.status).toBe(401);
  });

  it("recusa sem sessão, sem consultar o banco", async () => {
    verifyMock.mockResolvedValue(null);

    const result = await requireDashboardUser();

    expect("error" in result && result.error.status).toBe(401);
    expect(getAppUserMock).not.toHaveBeenCalled();
  });
});

describe("requireDashboardTracking", () => {
  it.each(["admin", "paid_traffic"] as const)("libera %s ativo", async (role) => {
    getAppUserMock.mockResolvedValue({ id: "user-1", role, is_active: true });

    expect("viewer" in (await requireDashboardTracking())).toBe(true);
  });

  it("recusa membro ativo", async () => {
    getAppUserMock.mockResolvedValue({ id: "user-1", role: "member", is_active: true });

    const result = await requireDashboardTracking();

    expect("error" in result && result.error.status).toBe(403);
  });
});
