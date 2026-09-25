import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  viewerMock,
  integrationMock,
  checkNumberMock,
  adminClientMock,
  fromMock,
  resolveIdentityMock,
} = vi.hoisted(() => ({
  viewerMock: vi.fn(),
  integrationMock: vi.fn(),
  checkNumberMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
  resolveIdentityMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  getDashboardViewer: viewerMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({
  getUazapiIntegration: integrationMock,
}));
vi.mock("@/features/chat/lib/senders/uazapi", () => ({
  checkUazapiNumber: checkNumberMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/leads/queries/resolve-lead-identity", () => ({
  resolveLeadIdentity: resolveIdentityMock,
}));

import { POST } from "@/app/api/chat/conversations/start/route";

function request(body: unknown) {
  return new Request("http://x/api/chat/conversations/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  viewerMock.mockResolvedValue({ id: "user-1", is_active: true });
  integrationMock.mockResolvedValue({
    id: "integration-1",
    apiUrl: "https://inst.uazapi.com",
    token: "token-secreto",
  });
  adminClientMock.mockReturnValue({ from: fromMock });
  resolveIdentityMock.mockResolvedValue({
    leadId: "lead-1",
    normalizedPhone: "11990000001",
    created: false,
    initialDealId: null,
  });
});

describe("POST /api/chat/conversations/start", () => {
  it("recusa chamada sem sessão antes de consultar a uazapi", async () => {
    viewerMock.mockResolvedValue(null);

    const response = await POST(request({ phone: "+55 11 99000-0001" }));

    expect(response.status).toBe(401);
    expect(checkNumberMock).not.toHaveBeenCalled();
  });

  it("informa quando o número não existe no WhatsApp", async () => {
    checkNumberMock.mockResolvedValue({
      exists: false,
      phone: "5511990000001",
      jid: null,
      verifiedName: null,
    });

    const response = await POST(request({ phone: "+55 11 99000-0001" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ exists: false });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("cria conversa humana para um número válido e devolve seu id", async () => {
    checkNumberMock.mockResolvedValue({
      exists: true,
      phone: "5511990000001",
      jid: "5511990000001@s.whatsapp.net",
      verifiedName: "Abner",
    });
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const selectExisting = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    }));
    const single = vi.fn(async () => ({
      data: { id: "conversation-1", contact_phone: "5511990000001" },
      error: null,
    }));
    const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
    fromMock.mockReturnValue({ select: selectExisting, insert });

    const response = await POST(
      request({ phone: "+55 11 99000-0001", name: "Nome enviado" })
    );

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_id: "integration-1",
        external_id: "5511990000001",
        contact_phone: "5511990000001",
        contact_name: "Abner",
        lead_id: "lead-1",
        status: "human",
      })
    );
    expect(await response.json()).toMatchObject({
      exists: true,
      conversation: { id: "conversation-1" },
    });
  });
});
