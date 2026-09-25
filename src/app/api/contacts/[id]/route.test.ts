import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, adminClientMock, updateMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminClientMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { DELETE, PATCH } from "@/app/api/contacts/[id]/route";

const CONTACT_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";
const params = { params: Promise.resolve({ id: CONTACT_ID }) };

function patch(body: unknown) {
  return new Request(`http://x/api/contacts/${CONTACT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let found: { id: string } | null;

beforeEach(() => {
  vi.clearAllMocks();
  found = { id: CONTACT_ID };
  sessionMock.mockResolvedValue({ viewer: { id: "user-1" } });
  const maybeSingle = vi.fn(async () => ({ data: found, error: null }));
  updateMock.mockReturnValue({
    eq: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })) })),
  });
  adminClientMock.mockReturnValue({ from: vi.fn(() => ({ update: updateMock })) });
});

describe("PATCH /api/contacts/[id]", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await PATCH(patch({ notes: "x" }), params);

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("recusa trocar o telefone com 422, mesmo junto de campo válido", async () => {
    const response = await PATCH(patch({ phone: "47988887777", notes: "x" }), params);

    expect(response.status).toBe(422);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("grava só as colunas editáveis e limpa texto vazio", async () => {
    const response = await PATCH(
      patch({ notes: "  ", email: "maria@exemplo.com", status: "cliente" }),
      params
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ notes: null, email: "maria@exemplo.com" });
  });

  it("recusa corpo sem nada para atualizar", async () => {
    const response = await PATCH(patch({}), params);

    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("responde 404 quando o contato não existe", async () => {
    found = null;

    const response = await PATCH(patch({ notes: "x" }), params);

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/contacts/[id]", () => {
  it("arquiva em vez de apagar", async () => {
    const response = await DELETE(new Request("http://x"), params);

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ archived_at: expect.any(String) });
  });
});
