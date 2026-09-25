import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocka as fronteiras: auth admin, validação/registro na uazapi, o Vault e o
// client admin.
const {
  requireAdminMock,
  statusMock,
  webhookMock,
  adminClientMock,
  fromMock,
  getSecretMock,
  setSecretMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  statusMock: vi.fn(),
  webhookMock: vi.fn(async () => {}),
  fromMock: vi.fn(),
  adminClientMock: vi.fn(),
  getSecretMock: vi.fn(),
  setSecretMock: vi.fn<(supabase: unknown, id: string, kind: string, value: string) => Promise<void>>(
    async () => {}
  ),
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
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getChatIntegrationSecret: getSecretMock,
  setChatIntegrationSecret: setSecretMock,
}));

import { POST } from "@/app/api/connection/persist/route";

function req(body: unknown) {
  return new Request("http://x/api/connection/persist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const insert = vi.fn();
const update = vi.fn();
let existing: { id: string } | null;

beforeEach(() => {
  existing = null;
  requireAdminMock.mockResolvedValue({ viewer: { id: "u1" } });
  statusMock.mockResolvedValue({ connected: false, state: "connecting", owner: null });
  getSecretMock.mockResolvedValue(null);

  const maybeSingle = vi.fn(async () => ({ data: existing, error: null }));
  const select = vi.fn(() => ({ eq: () => ({ maybeSingle }) }));
  const single = vi.fn(async () => ({ data: { id: "int-1" }, error: null }));
  insert.mockReturnValue({ select: () => ({ single }) });
  update.mockReturnValue({ eq: async () => ({ error: null }) });
  fromMock.mockReturnValue({ select, insert, update });
  adminClientMock.mockReturnValue({ from: fromMock });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/connection/persist", () => {
  it("credencial inválida (status falha) → 422 e NÃO grava nada", async () => {
    statusMock.mockRejectedValue(new Error("uazapi status 404: host not mapped"));

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

  it("grava só a URL no config e o token no Vault", async () => {
    const res = await POST(req({ apiUrl: "https://ok.uazapi.com", token: "token-abc-123" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, integrationId: "int-1", webhookRegistered: true });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ config: { apiUrl: "https://ok.uazapi.com" } })
    );
    // Nenhuma escrita de tabela carrega o token.
    for (const call of [...insert.mock.calls, ...update.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain("token-abc-123");
    }
    expect(setSecretMock).toHaveBeenCalledWith(expect.anything(), "int-1", "token", "token-abc-123");
  });

  it("gera o segredo do webhook na primeira conexão e o usa na URL", async () => {
    await POST(req({ apiUrl: "https://ok.uazapi.com", token: "token-abc-123" }));

    const generated = setSecretMock.mock.calls.find((call) => call[2] === "webhook_secret");
    expect(generated?.[3]).toMatch(/^[0-9a-f]{64}$/);
    expect(webhookMock).toHaveBeenCalledWith(
      "https://ok.uazapi.com",
      "token-abc-123",
      `http://x/api/chat/webhook/uazapi?s=${generated?.[3]}`
    );
  });

  it("reconectar mantém o segredo do webhook que já existe", async () => {
    existing = { id: "int-1" };
    getSecretMock.mockResolvedValue("segredo-que-ja-existia");

    await POST(req({ apiUrl: "https://ok.uazapi.com", token: "token-abc-123" }));

    expect(insert).not.toHaveBeenCalled();
    expect(setSecretMock).not.toHaveBeenCalledWith(
      expect.anything(),
      "int-1",
      "webhook_secret",
      expect.anything()
    );
    expect(webhookMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "http://x/api/chat/webhook/uazapi?s=segredo-que-ja-existia"
    );
  });

  it("falha do Vault ao gravar o token → 500 e não registra webhook", async () => {
    setSecretMock.mockRejectedValueOnce(new Error("vault indisponível"));

    const res = await POST(req({ apiUrl: "https://ok.uazapi.com", token: "token-abc-123" }));

    expect(res.status).toBe(500);
    expect(webhookMock).not.toHaveBeenCalled();
  });
});
