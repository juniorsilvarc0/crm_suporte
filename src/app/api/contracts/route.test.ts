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

import { POST } from "@/app/api/contracts/route";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const CONTRACT_ID = "44444444-4444-4444-8444-444444444444";

// Como o formulário envia: campos de texto, vazio = "".
const form = {
  customer_id: CUSTOMER_ID,
  starts_on: "2026-09-01",
  ends_on: "",
  monthly_amount: "1500.50",
  billing_day: "10",
  plan_id: "",
  product_ids: [PRODUCT_ID],
};

function post(body: unknown) {
  return new Request("http://x/api/contracts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// O que a RPC recebe de fato: o supabase-js serializa os args em JSON.
function sentArgs(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rpcMock.mock.calls[0][1]));
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  rpcMock.mockResolvedValue({ data: CONTRACT_ID, error: null });
  adminClientMock.mockReturnValue({ rpc: rpcMock });
});

describe("POST /api/contracts", () => {
  it("member → 403 sem chamar a RPC", async () => {
    adminMock.mockResolvedValue({
      error: Response.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    });

    const response = await POST(post(form));

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("chama a RPC com o admin da sessão e o valor como número", async () => {
    const response = await POST(post({ ...form, plan_id: PLAN_ID, ends_on: "2027-08-31" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, message: "Contrato criado.", contract: { id: CONTRACT_ID } });
    expect(rpcMock).toHaveBeenCalledWith("create_support_contract", {
      p_actor_id: "admin-1",
      p_customer_id: CUSTOMER_ID,
      p_status: "ativo",
      p_starts_on: "2026-09-01",
      p_monthly_amount: 1500.5,
      p_billing_day: 10,
      p_product_ids: [PRODUCT_ID],
      p_plan_id: PLAN_ID,
      p_ends_on: "2027-08-31",
    });
  });

  it("plano e término nulos viram chave ausente", async () => {
    await POST(post({ ...form, plan_id: null, ends_on: null }));

    const args = sentArgs();
    expect(args).not.toHaveProperty("p_plan_id");
    expect(args).not.toHaveProperty("p_ends_on");
    expect(args.p_actor_id).toBe("admin-1");
  });

  it("valor com máscara brasileira → 400 sem chamar a RPC", async () => {
    const response = await POST(post({ ...form, monthly_amount: "1.500,00" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.monthly_amount).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("recusa o autor vindo do corpo: ele sai da sessão", async () => {
    const response = await POST(post({ ...form, created_by_user_id: "outro" }));

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("FORBIDDEN da RPC (admin rebaixado no meio) → 403", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "FORBIDDEN" } });

    const response = await POST(post(form));

    expect(response.status).toBe(403);
  });

  it("CURRENT_CONTRACT_EXISTS → 409", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "CURRENT_CONTRACT_EXISTS" },
    });

    const response = await POST(post(form));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.message).toBe(
      "Esta empresa já tem um contrato vigente. Encerre-o antes de criar outro."
    );
  });

  it("erro de campo da RPC cai no campo", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "PRODUCT_ARCHIVED" } });

    const response = await POST(post(form));
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.errors).toEqual({ product_ids: ["Um dos produtos foi arquivado."] });
  });

  it("42501 sem TAG → 500 logado, sem repassar a mensagem do banco", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table support_contracts" },
    });

    const response = await POST(post(form));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.message).toBe("Não foi possível concluir a operação.");
    expect(JSON.stringify(json)).not.toContain("permission denied");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
