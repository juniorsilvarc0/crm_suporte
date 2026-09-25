import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, adminClientMock, rpcMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  adminClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: adminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { PATCH } from "@/app/api/contracts/[id]/route";

const CONTRACT_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const params = { params: Promise.resolve({ id: CONTRACT_ID }) };

const form = {
  starts_on: "2026-09-01",
  ends_on: "",
  monthly_amount: "1500.00",
  billing_day: "10",
  plan_id: "",
  product_ids: [PRODUCT_ID],
};

function patch(body: unknown) {
  return new Request(`http://x/api/contracts/${CONTRACT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  rpcMock.mockResolvedValue({ data: null, error: null });
  adminClientMock.mockReturnValue({ rpc: rpcMock });
});

describe("PATCH /api/contracts/[id]", () => {
  it("member → 403 sem chamar a RPC", async () => {
    adminMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sem permissão." }, { status: 403 }),
    });

    const response = await PATCH(patch(form), params);

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem chamar a RPC", async () => {
    const response = await PATCH(patch(form), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([["status", "encerrado"], ["customer_id", "11111111-1111-4111-8111-111111111111"]])(
    "%s no corpo → 400: a edição não muda empresa nem situação",
    async (key, value) => {
      const response = await PATCH(patch({ ...form, [key]: value }), params);

      expect(response.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    }
  );

  it("grava pela RPC com o admin da sessão; plano e término vazios ficam ausentes", async () => {
    const response = await PATCH(patch(form), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, message: "Contrato atualizado." });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0];
    expect(name).toBe("update_support_contract");
    expect(JSON.parse(JSON.stringify(args))).toEqual({
      p_actor_id: "admin-1",
      p_contract_id: CONTRACT_ID,
      p_starts_on: "2026-09-01",
      p_monthly_amount: 1500,
      p_billing_day: 10,
      p_product_ids: [PRODUCT_ID],
    });
  });

  it("término antes do início → 400 no campo, sem chamar a RPC", async () => {
    const response = await PATCH(patch({ ...form, ends_on: "2026-08-01" }), params);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.ends_on).toEqual(["O término não pode ser antes do início."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("CONTRACT_CLOSED → 409", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "CONTRACT_CLOSED" } });

    const response = await PATCH(patch(form), params);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.message).toBe("Contrato encerrado não pode ser alterado. Crie um novo.");
  });

  it("CONTRACT_NOT_FOUND → 404", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "CONTRACT_NOT_FOUND" } });

    const response = await PATCH(patch(form), params);

    expect(response.status).toBe(404);
  });
});
