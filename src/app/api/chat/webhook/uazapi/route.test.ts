// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, integrationMock, secretMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  integrationMock: vi.fn(),
  secretMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getUazapiIntegration: integrationMock,
  getChatIntegrationSecret: secretMock,
}));

import { POST } from "@/app/api/chat/webhook/uazapi/route";

const SECRET = "a".repeat(64);

function webhook(secret: string | null, body: unknown = { EventType: "presence" }) {
  const query = secret === null ? "" : `?s=${encodeURIComponent(secret)}`;
  return new Request(`http://x/api/chat/webhook/uazapi${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adminClientMock.mockReturnValue({});
  integrationMock.mockResolvedValue({
    id: "int-1",
    apiUrl: "https://inst.uazapi.test",
    token: "token",
    phone_number: null,
  });
  secretMock.mockResolvedValue(SECRET);
});

describe("POST /api/chat/webhook/uazapi — autenticação", () => {
  it("aceita o segredo da integração e segue para o processamento", async () => {
    const response = await POST(webhook(SECRET));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, reason: "skipped" });
    expect(secretMock).toHaveBeenCalledWith(expect.anything(), "int-1", "webhook_secret");
  });

  it.each([
    ["sem ?s=", null],
    ["?s= vazio", ""],
    ["?s= errado", "b".repeat(64)],
  ])("recusa %s com 401", async (_label, secret) => {
    const response = await POST(webhook(secret));

    expect(response.status).toBe(401);
  });

  it("recusa com 401 quando a integração não tem segredo no Vault", async () => {
    secretMock.mockResolvedValue(null);

    const response = await POST(webhook(""));

    expect(response.status).toBe(401);
  });

  it("sem integração responde o mesmo 401, sem revelar que não há instância", async () => {
    integrationMock.mockResolvedValue(null);

    const response = await POST(webhook(SECRET));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, reason: "unauthorized" });
    expect(secretMock).not.toHaveBeenCalled();
  });

  it("não lê o corpo de quem não se autenticou", async () => {
    const request = webhook("errado");
    const json = vi.spyOn(request, "json");

    await POST(request);

    expect(json).not.toHaveBeenCalled();
  });
});
