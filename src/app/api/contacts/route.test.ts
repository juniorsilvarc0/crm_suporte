import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, adminClientMock, selectMock, resolveIdentityMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminClientMock: vi.fn(),
  selectMock: vi.fn(),
  resolveIdentityMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/features/contacts/queries/resolve-contact-identity", () => ({
  resolveContactIdentity: resolveIdentityMock,
}));

import { POST } from "@/app/api/contacts/route";

const CONTACT_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";

function request(body: unknown) {
  return new Request("http://x/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ viewer: { id: "user-1" } });
  const single = vi.fn(async () => ({
    data: {
      id: CONTACT_ID,
      name: "Maria",
      phone: "(47) 99999-9999",
      normalized_phone: "47999999999",
    },
    error: null,
  }));
  selectMock.mockReturnValue({ eq: vi.fn(() => ({ single })) });
  resolveIdentityMock.mockResolvedValue({
    contactId: CONTACT_ID,
    normalizedPhone: "47999999999",
    created: true,
  });
  adminClientMock.mockReturnValue({
    from: vi.fn(() => ({ select: selectMock })),
  });
});

describe("POST /api/contacts", () => {
  it("recusa cadastro sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await POST(request({ phone: "47999999999" }));

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("recusa telefone sem DDD sem chamar o resolvedor", async () => {
    const response = await POST(request({ phone: "9999-99999" }));

    expect(response.status).toBe(400);
    expect(resolveIdentityMock).not.toHaveBeenCalled();
  });

  it("cria o contato pelo resolvedor de identidade", async () => {
    const response = await POST(
      request({ name: "Maria", phone: "(47) 99999-9999", source: "indicacao" })
    );

    expect(response.status).toBe(200);
    expect(resolveIdentityMock).toHaveBeenCalledWith(expect.anything(), {
      phone: "(47) 99999-9999",
      name: "Maria",
      source: "indicacao",
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      created: true,
      contact: { id: CONTACT_ID, normalized_phone: "47999999999" },
    });
  });

  it("usa a origem manual quando a tela não informa", async () => {
    await POST(request({ phone: "47999999999" }));

    expect(resolveIdentityMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "manual" })
    );
  });

  it("recusa a origem reservada à API de integração", async () => {
    const response = await POST(request({ phone: "47999999999", source: "api" }));

    expect(response.status).toBe(400);
    expect(resolveIdentityMock).not.toHaveBeenCalled();
  });

  it("responde 409 quando o número já é alias de outra pessoa", async () => {
    resolveIdentityMock.mockRejectedValue({ code: "23505" });

    const response = await POST(request({ phone: "47999999999" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      message: "Este telefone já pertence a outra pessoa.",
    });
  });
});
