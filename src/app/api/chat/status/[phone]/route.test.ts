import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, findLeadByPhoneMock, eqMock, isMock, maybeSingleMock } = vi.hoisted(
  () => ({
    adminClientMock: vi.fn(),
    findLeadByPhoneMock: vi.fn(),
    eqMock: vi.fn(),
    isMock: vi.fn(),
    maybeSingleMock: vi.fn(),
  })
);

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/leads/queries/webhook-mutations", () => ({
  findLeadByPhone: findLeadByPhoneMock,
}));

import { GET } from "@/app/api/chat/status/[phone]/route";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingleMock.mockResolvedValue({ data: { status: "human" }, error: null });
  const chain = {
    eq: eqMock,
    is: isMock,
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: maybeSingleMock,
  };
  eqMock.mockReturnValue(chain);
  isMock.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  adminClientMock.mockReturnValue({
    from: vi.fn(() => ({ select: vi.fn(() => chain) })),
  });
});

describe("GET /api/chat/status/[phone]", () => {
  it("resolve a pessoa canônica e consulta somente conversa ativa", async () => {
    findLeadByPhoneMock.mockResolvedValue({ id: "lead-1" });

    const response = await GET(new Request("http://x"), {
      params: Promise.resolve({ phone: encodeURIComponent("+55 (86) 99999-9999") }),
    });

    expect(findLeadByPhoneMock).toHaveBeenCalledWith(
      expect.anything(),
      "+55 (86) 99999-9999"
    );
    expect(eqMock).toHaveBeenCalledWith("lead_id", "lead-1");
    expect(isMock).toHaveBeenCalledWith("removed_at", null);
    expect(await response.json()).toEqual({
      phone: "+55 (86) 99999-9999",
      status: "human",
      human_active: true,
    });
  });

  it("devolve bot quando o telefone ainda não pertence a uma pessoa", async () => {
    findLeadByPhoneMock.mockResolvedValue(null);

    const response = await GET(new Request("http://x"), {
      params: Promise.resolve({ phone: "86999999999" }),
    });

    expect(await response.json()).toEqual({
      phone: "86999999999",
      status: "bot",
      human_active: false,
    });
  });
});
