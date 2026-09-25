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
let dbError: { code: string; message: string } | null;

beforeEach(() => {
  vi.clearAllMocks();
  found = { id: CONTACT_ID };
  dbError = null;
  sessionMock.mockResolvedValue({ viewer: { id: "user-1" } });
  const maybeSingle = vi.fn(async () => ({ data: dbError ? null : found, error: dbError }));
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

describe("PATCH /api/contacts/[id] — vínculo com a empresa", () => {
  const CUSTOMER_ID = "0b7a2c9e-5f41-4d2a-9c3e-7e1f00a1b2c3";

  it("liga o contato à empresa gravando só customer_id", async () => {
    const response = await PATCH(patch({ customer_id: CUSTOMER_ID }), params);

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ customer_id: CUSTOMER_ID });
  });

  it("desliga com null explícito", async () => {
    const response = await PATCH(patch({ customer_id: null }), params);

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ customer_id: null });
  });

  it("recusa customer_id fora de UUID com 400 no campo, sem acessar o banco", async () => {
    const response = await PATCH(patch({ customer_id: "empresa-1" }), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      errors: { customer_id: ["Empresa inválida."] },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("empresa arquivada (CUSTOMER_ARCHIVED) responde 422 no campo", async () => {
    dbError = { code: "P0001", message: "CUSTOMER_ARCHIVED" };

    const response = await PATCH(patch({ customer_id: CUSTOMER_ID }), params);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Empresa arquivada. Reative-a antes.",
      errors: { customer_id: ["Empresa arquivada. Reative-a antes."] },
    });
  });

  it("empresa inexistente (23503 na FK) responde 422 no campo", async () => {
    dbError = {
      code: "23503",
      message:
        'insert or update on table "contacts" violates foreign key constraint "contacts_customer_id_fkey"',
    };

    const response = await PATCH(patch({ customer_id: CUSTOMER_ID }), params);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      message: "Empresa não encontrada.",
      errors: { customer_id: ["Empresa não encontrada."] },
    });
  });

  it("outro erro do banco continua 500, sem repassar a mensagem do banco", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    dbError = { code: "42501", message: "permission denied for table contacts" };

    const response = await PATCH(patch({ customer_id: CUSTOMER_ID }), params);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("permission denied");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("DELETE /api/contacts/[id]", () => {
  it("arquiva em vez de apagar", async () => {
    const response = await DELETE(new Request("http://x"), params);

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ archived_at: expect.any(String) });
  });
});
