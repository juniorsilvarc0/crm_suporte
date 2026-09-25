import { afterEach, describe, expect, it, vi } from "vitest";

// Mocka as fronteiras: auth admin, validação/registro na uazapi, e o client admin.
const { requireAdminMock, statusMock, webhookMock, adminClientMock, fromMock } =
  vi.hoisted(() => ({
    requireAdminMock: vi.fn(),
    statusMock: vi.fn(),
    webhookMock: vi.fn(async () => {}),
    fromMock: vi.fn(),
    adminClientMock: vi.fn(),
  }));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/connection/ssrf-guard", () => ({
  safeBaseUrl: (u: string) => u.replace(/\/+$/, ""),
}));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({
  assertUazapiCredentials: vi.fn(), // não lança (formato ok)
  getUazapiStatus: statusMock,
  registerUazapiWebhook: webhookMock,
}));

import { POST } from "@/app/api/connection/persist/route";

function req(body: unknown) {
  return new Request("http://x/api/connection/persist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  adminClientMock.mockReturnValue({ from: fromMock });
});

describe("POST /api/connection/persist", () => {
  it("credencial inválida (status falha) → 422 e NÃO grava nada", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1" } });
    statusMock.mockRejectedValue(new Error("uazapi status 404: host not mapped"));
    adminClientMock.mockReturnValue({ from: fromMock });

    const res = await POST(
      req({ apiUrl: "https://errada.uazapi.com", token: "token-abc-123" })
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toMatchObject({ ok: false, code: "invalid_credentials" });
    // validou antes de tocar no banco: nem criou o client → não gravou
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(webhookMock).not.toHaveBeenCalled();
  });

  it("credencial válida → valida, grava (insert) e retorna ok", async () => {
    requireAdminMock.mockResolvedValue({ viewer: { id: "u1" } });
    statusMock.mockResolvedValue({ connected: false, state: "connecting", owner: null });

    const single = vi.fn(async () => ({ data: { id: "int-1" }, error: null }));
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const maybeSingle = vi.fn(async () => ({ data: null, error: null })); // sem integração existente
    const select = vi.fn(() => ({ eq: () => ({ limit: () => ({ maybeSingle }) }) }));
    fromMock.mockReturnValue({ select, insert });
    adminClientMock.mockReturnValue({ from: fromMock });

    const res = await POST(req({ apiUrl: "https://ok.uazapi.com", token: "token-abc-123" }));
    const body = await res.json();

    expect(statusMock).toHaveBeenCalledTimes(1); // validou
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, integrationId: "int-1" });
    expect(insert).toHaveBeenCalledTimes(1); // gravou
  });
});
