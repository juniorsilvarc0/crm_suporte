import { beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, adminMock, adminClientMock, fromMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  adminMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
  requireDashboardAdmin: adminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { DELETE, PATCH } from "@/app/api/customers/[id]/route";
import { POST as RESTORE } from "@/app/api/customers/[id]/restore/route";

const CUSTOMER_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";
const params = { params: Promise.resolve({ id: CUSTOMER_ID }) };

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada; maybeSingle resolve com `result`.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq", "is", "not"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push(["maybeSingle"]);
    return Promise.resolve(result);
  };
  return { builder, calls };
}

function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const callsOf = (calls: Call[], method: string) =>
  calls.filter(([name]) => name === method).map(([, ...args]) => args);

function patch(body: unknown, context = params) {
  return PATCH(
    new Request(`http://x/api/customers/${CUSTOMER_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    context
  );
}

const remove = () => DELETE(new Request("http://x"), params);
const restore = () => RESTORE(new Request("http://x"), params);

const UNAUTHORIZED = () => ({
  error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
});
const FORBIDDEN = () => ({
  error: Response.json(
    { ok: false, message: "Apenas administradores podem executar esta ação." },
    { status: 403 }
  ),
});

const CNPJ_CONFLICT = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "customers_cnpj_active_uidx"',
};

function asMember() {
  userMock.mockResolvedValue({ viewer: { id: "user-1", role: "member" } });
  adminMock.mockResolvedValue(FORBIDDEN());
}

function asAdmin() {
  userMock.mockResolvedValue({ viewer: { id: "user-1", role: "admin" } });
  adminMock.mockResolvedValue({ viewer: { id: "user-1", role: "admin" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMember();
  adminClientMock.mockReturnValue({ from: fromMock });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("PATCH /api/customers/[id]", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    userMock.mockResolvedValue(UNAUTHORIZED());

    const response = await patch({ legal_name: "Empresa Alfa" });

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("recusa id fora do formato de UUID", async () => {
    const response = await patch(
      { legal_name: "Empresa Alfa" },
      { params: Promise.resolve({ id: "1 or 1=1" }) }
    );

    expect(response.status).toBe(400);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("member edita; grava só as chaves enviadas, só em empresa ativa", async () => {
    const [calls] = queueQueries({ data: { id: CUSTOMER_ID }, error: null });

    const response = await patch({ legal_name: "  Empresa Alfa Ltda " });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "Empresa atualizada." });
    expect(callsOf(calls, "update")).toEqual([[{ legal_name: "Empresa Alfa Ltda" }]]);
    expect(callsOf(calls, "eq")).toEqual([["id", CUSTOMER_ID]]);
    expect(callsOf(calls, "is")).toEqual([["archived_at", null]]);
    expect(adminMock).not.toHaveBeenCalled();
  });

  it("null explícito apaga o campo; ausente não", async () => {
    const [calls] = queueQueries({ data: { id: CUSTOMER_ID }, error: null });

    await patch({ cnpj: null, notes: "" });

    expect(callsOf(calls, "update")).toEqual([[{ cnpj: null, notes: null }]]);
  });

  it("recusa archived_at no corpo com 400, sem gravar", async () => {
    const response = await patch({ legal_name: "Empresa Alfa", archived_at: null });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toContain("archived_at");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("recusa corpo sem nada para atualizar", async () => {
    const response = await patch({});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Nada para atualizar.");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("empresa arquivada → 409 pedindo para reativar", async () => {
    queueQueries(
      { data: null, error: null },
      { data: { id: CUSTOMER_ID, archived_at: "2026-09-20T10:00:00Z" }, error: null }
    );

    const response = await patch({ legal_name: "Empresa Alfa" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.message).toBe("Empresa arquivada. Reative-a antes de editar.");
  });

  it("empresa inexistente → 404", async () => {
    queueQueries({ data: null, error: null }, { data: null, error: null });

    const response = await patch({ legal_name: "Empresa Alfa" });

    expect(response.status).toBe(404);
  });

  it("CNPJ de outra empresa ativa → 409 no campo cnpj", async () => {
    queueQueries({ data: null, error: CNPJ_CONFLICT });

    const response = await patch({ cnpj: "11.222.333/0001-81" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors).toEqual({ cnpj: ["Já existe empresa ativa com este CNPJ."] });
  });
});

describe("DELETE /api/customers/[id]", () => {
  it("member → 403 sem acessar o banco", async () => {
    const response = await remove();

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("admin arquiva só a empresa ativa", async () => {
    asAdmin();
    const [calls] = queueQueries({ data: { id: CUSTOMER_ID }, error: null });

    const response = await remove();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      archived: true,
      message: "Empresa arquivada.",
    });
    expect(callsOf(calls, "update")).toEqual([[{ archived_at: expect.any(String) }]]);
    expect(callsOf(calls, "is")).toEqual([["archived_at", null]]);
  });

  it("contrato vigente → 409 CUSTOMER_HAS_CURRENT_CONTRACT", async () => {
    asAdmin();
    queueQueries({
      data: null,
      error: { code: "P0001", message: "CUSTOMER_HAS_CURRENT_CONTRACT" },
    });

    const response = await remove();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.message).toBe("Encerre o contrato vigente antes de arquivar a empresa.");
  });

  it("já arquivada → 200 (o filtro preserva a data do primeiro arquivamento)", async () => {
    asAdmin();
    queueQueries({ data: null, error: null }, { data: { id: CUSTOMER_ID }, error: null });

    const response = await remove();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, archived: true, message: "Empresa já estava arquivada." });
  });

  it("empresa inexistente → 404", async () => {
    asAdmin();
    queueQueries({ data: null, error: null }, { data: null, error: null });

    const response = await remove();

    expect(response.status).toBe(404);
  });
});

describe("POST /api/customers/[id]/restore", () => {
  it("member → 403 sem acessar o banco", async () => {
    const response = await restore();

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("admin reativa só a empresa arquivada", async () => {
    asAdmin();
    const [calls] = queueQueries({ data: { id: CUSTOMER_ID }, error: null });

    const response = await restore();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: "Empresa reativada." });
    expect(callsOf(calls, "update")).toEqual([[{ archived_at: null }]]);
    expect(callsOf(calls, "not")).toEqual([["archived_at", "is", null]]);
  });

  it("CNPJ tomado por outra empresa ativa → 409 no campo cnpj", async () => {
    asAdmin();
    queueQueries({ data: null, error: CNPJ_CONFLICT });

    const response = await restore();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors).toEqual({ cnpj: ["Já existe empresa ativa com este CNPJ."] });
  });

  it("já ativa → 200", async () => {
    asAdmin();
    queueQueries({ data: null, error: null }, { data: { id: CUSTOMER_ID }, error: null });

    const response = await restore();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, message: "Empresa já estava ativa." });
  });

  it("empresa inexistente → 404", async () => {
    asAdmin();
    queueQueries({ data: null, error: null }, { data: null, error: null });

    const response = await restore();

    expect(response.status).toBe(404);
  });
});
