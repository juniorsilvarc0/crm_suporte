import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sessionMock,
  adminClientMock,
  selectMock,
  resolveIdentityMock,
  setStatusMock,
  revalidatePathMock,
} = vi.hoisted(
  () => ({
    sessionMock: vi.fn(),
    adminClientMock: vi.fn(),
    selectMock: vi.fn(),
    resolveIdentityMock: vi.fn(),
    setStatusMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
);

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/require-dashboard-session", () => ({
  hasDashboardSession: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/leads/queries/resolve-lead-identity", () => ({
  resolveLeadIdentity: resolveIdentityMock,
}));
vi.mock("@/features/leads/queries/set-lead-status", () => ({
  isAmbiguousLeadStatusError: () => false,
  setLeadStatusFromSingleDeal: setStatusMock,
}));

import { POST } from "@/app/api/leads/manual/route";

function request(body: unknown) {
  return new Request("http://x/api/leads/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(true);
  const single = vi.fn(async () => ({
    data: {
      id: "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07",
      name: "Maria",
      phone: "(47) 99999-9999",
      normalized_phone: "47999999999",
    },
    error: null,
  }));
  selectMock.mockReturnValue({ eq: vi.fn(() => ({ single })) });
  resolveIdentityMock.mockResolvedValue({
    leadId: "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07",
    normalizedPhone: "47999999999",
    created: false,
    initialDealId: "deal-1",
  });
  setStatusMock.mockResolvedValue({
    leadId: "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07",
    dealId: "deal-1",
    status: "pre_consulta",
  });
  adminClientMock.mockReturnValue({
    from: vi.fn(() => ({ select: selectMock })),
  });
});

describe("POST /api/leads/manual", () => {
  it("recusa cadastro sem sessão antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue(false);

    const response = await POST(request({ phone: "47999999999" }));

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("promove o contato para lead ativo e atualiza Leads e Funil", async () => {
    const response = await POST(
      request({
        name: "Maria",
        phone: "(47) 99999-9999",
        source: "whatsapp",
        status: "pre_consulta",
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveIdentityMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phone: "(47) 99999-9999", createInitialDeal: true })
    );
    expect(setStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "pre_consulta",
        leadPatch: expect.objectContaining({
          normalized_phone: "47999999999",
          imported: false,
        }),
      })
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/leads");
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/funil");
    expect(await response.json()).toMatchObject({
      ok: true,
      lead: { name: "Maria", normalized_phone: "47999999999" },
    });
  });
});
