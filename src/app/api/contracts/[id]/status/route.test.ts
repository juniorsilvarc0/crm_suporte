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

import { POST } from "@/app/api/contracts/[id]/status/route";

const CONTRACT_ID = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ id: CONTRACT_ID }) };

function post(body: unknown) {
  return new Request(`http://x/api/contracts/${CONTRACT_ID}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  rpcMock.mockResolvedValue({
    data: { status: "suspenso", ends_on: null, changed: true },
    error: null,
  });
  adminClientMock.mockReturnValue({ rpc: rpcMock });
});

describe("POST /api/contracts/[id]/status", () => {
  it("member → 403 sem chamar a RPC", async () => {
    adminMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sem permissão." }, { status: 403 }),
    });

    const response = await POST(post({ status: "suspenso" }), params);

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400 sem chamar a RPC", async () => {
    const response = await POST(post({ status: "suspenso" }), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("situação fora da lista → 400 no campo", async () => {
    const response = await POST(post({ status: "cancelado" }), params);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.status).toEqual(["Situação inválida."]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("suspende e devolve o contrato", async () => {
    const response = await POST(post({ status: "suspenso" }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("set_support_contract_status", {
      p_actor_id: "admin-1",
      p_contract_id: CONTRACT_ID,
      p_status: "suspenso",
      p_ends_on: undefined,
    });
    expect(json).toEqual({
      ok: true,
      message: "Contrato suspenso.",
      contract: { id: CONTRACT_ID, status: "suspenso", ends_on: null },
      changed: true,
    });
  });

  it("reativar tem mensagem própria", async () => {
    rpcMock.mockResolvedValue({
      data: { status: "ativo", ends_on: null, changed: true },
      error: null,
    });

    const json = await (await POST(post({ status: "ativo" }), params)).json();

    expect(json.message).toBe("Contrato reativado.");
  });

  it("changed:false → \"Nada mudou.\"", async () => {
    rpcMock.mockResolvedValue({
      data: { status: "suspenso", ends_on: null, changed: false },
      error: null,
    });

    const response = await POST(post({ status: "suspenso" }), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.message).toBe("Nada mudou.");
    expect(json.changed).toBe(false);
  });

  it("encerrar sem data manda p_ends_on ausente (a RPC usa hoje)", async () => {
    rpcMock.mockResolvedValue({
      data: { status: "encerrado", ends_on: "2026-09-25", changed: true },
      error: null,
    });

    const response = await POST(post({ status: "encerrado" }), params);
    const json = await response.json();

    const args = JSON.parse(JSON.stringify(rpcMock.mock.calls[0][1]));
    expect(args).not.toHaveProperty("p_ends_on");
    expect(json.message).toBe("Contrato encerrado.");
    expect(json.contract).toEqual({ id: CONTRACT_ID, status: "encerrado", ends_on: "2026-09-25" });
  });

  it("encerrar com data repassa a data", async () => {
    rpcMock.mockResolvedValue({
      data: { status: "encerrado", ends_on: "2026-09-30", changed: true },
      error: null,
    });

    await POST(post({ status: "encerrado", ends_on: "2026-09-30" }), params);

    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_ends_on: "2026-09-30" });
  });

  it("term_check → 422 com errors.ends_on", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message:
          'new row for relation "support_contracts" violates check constraint "support_contracts_term_check"',
      },
    });

    const response = await POST(post({ status: "encerrado", ends_on: "2020-01-01" }), params);
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.errors).toEqual({ ends_on: ["O término não pode ser antes do início."] });
  });

  it("CONTRACT_CLOSED → 409", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "CONTRACT_CLOSED" } });

    const response = await POST(post({ status: "ativo" }), params);

    expect(response.status).toBe(409);
  });

  it("retorno da RPC fora do formato → 500 logado", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: { status: "outro" }, error: null });

    const response = await POST(post({ status: "ativo" }), params);

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
