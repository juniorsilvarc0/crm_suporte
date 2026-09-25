import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, adminClientMock, fromMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { GET, POST } from "@/app/api/customers/route";

const VIEWER_ID = "0b5e8c9a-3f1d-4c2e-9a7b-6d5c4b3a2f10";
const CUSTOMER_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada. Aguardado direto (lista) ou por
// single/maybeSingle, resolve com `result`. Não tem `.or()`: se a busca um
// dia montar um, o teste quebra.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "insert", "eq", "is", "ilike", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const method of ["single", "maybeSingle"]) {
    builder[method] = () => {
      calls.push([method]);
      return Promise.resolve(result);
    };
  }
  return { builder, calls };
}

function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const callsOf = (calls: Call[], method: string) =>
  calls.filter(([name]) => name === method).map(([, ...args]) => args);

function get(query: string) {
  return GET(new Request(`http://x/api/customers${query}`));
}

function post(body: unknown) {
  return POST(
    new Request("http://x/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const summaryRow = {
  id: CUSTOMER_ID,
  legal_name: "Padaria S. João Ltda",
  trade_name: "Padaria São João",
  cnpj: "12ABC34501DE35",
  contract_status: "ativo",
  archived_at: null,
};

const CNPJ_CONFLICT = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "customers_cnpj_active_uidx"',
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ viewer: { id: VIEWER_ID, role: "member" } });
  adminClientMock.mockReturnValue({ from: fromMock });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/customers", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await get("?q=padaria");

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("busca por token normalizado em search_name, só entre ativas", async () => {
    const [calls] = queueQueries({ data: [summaryRow], error: null });

    const response = await get(`?q=${encodeURIComponent("Padaria São João")}`);

    expect(response.status).toBe(200);
    expect(fromMock).toHaveBeenCalledWith("customers");
    expect(callsOf(calls, "ilike")).toEqual([
      ["search_name", "%padaria%"],
      ["search_name", "%sao%"],
      ["search_name", "%joao%"],
    ]);
    expect(callsOf(calls, "is")).toContainEqual(["archived_at", null]);
  });

  it("termo só com pontuação não vira filtro", async () => {
    const [calls] = queueQueries({ data: [], error: null });

    const response = await get(`?q=${encodeURIComponent(" , ( ) % ")}`);

    expect(response.status).toBe(200);
    expect(callsOf(calls, "ilike")).toEqual([]);
  });

  it("não encosta em support_contracts e devolve só as colunas do resumo", async () => {
    const [calls] = queueQueries({
      data: [{ ...summaryRow, search_name: "padaria sao joao", monthly_amount: 999 }],
      error: null,
    });

    const response = await get("");
    const body = await response.json();

    const [[columns]] = callsOf(calls, "select");
    expect(columns).not.toContain("support_contracts");
    expect(columns).not.toContain("*");
    expect(body).toEqual({ ok: true, items: [summaryRow] });
  });

  it("limita o limit a 1..20, com 20 por padrão", async () => {
    const cases: [string, number][] = [
      ["", 20],
      ["?limit=5", 5],
      ["?limit=50", 20],
      ["?limit=0", 1],
      ["?limit=abc", 20],
    ];
    for (const [query, expected] of cases) {
      const [calls] = queueQueries({ data: [], error: null });
      await get(query);
      expect(callsOf(calls, "limit"), query).toEqual([[expected]]);
    }
  });

  it("erro de banco responde 500 sem repassar a mensagem do banco", async () => {
    queueQueries({ data: null, error: { code: "42501", message: "permission denied" } });

    const response = await get("?q=padaria");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, message: "Não foi possível buscar as empresas." });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("POST /api/customers", () => {
  it("recusa sem usuário ativo antes de acessar o banco", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await post({ legal_name: "Empresa Alfa" });

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("grava quem cadastrou e o CNPJ sem máscara, em caixa alta", async () => {
    const [calls] = queueQueries({ data: { id: CUSTOMER_ID }, error: null });

    const response = await post({
      legal_name: " Padaria S. João Ltda ",
      trade_name: "Padaria São João",
      cnpj: "12.abc.345/01de-35",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "Empresa cadastrada.",
      customer: { id: CUSTOMER_ID },
    });
    expect(callsOf(calls, "insert")).toEqual([
      [
        {
          legal_name: "Padaria S. João Ltda",
          trade_name: "Padaria São João",
          cnpj: "12ABC34501DE35",
          notes: null,
          created_by_user_id: VIEWER_ID,
        },
      ],
    ]);
    expect(callsOf(calls, "select")).toEqual([["id"]]);
  });

  it("recusa CNPJ com dígito verificador errado sem acessar o banco", async () => {
    const response = await post({ legal_name: "Empresa Alfa", cnpj: "11.222.333/0001-80" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toEqual({ cnpj: ["CNPJ inválido — confira os caracteres."] });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("recusa o selo no corpo em vez de descartá-lo", async () => {
    const response = await post({ legal_name: "Empresa Alfa", contract_status: "ativo" });

    expect(response.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("CNPJ de outra empresa ativa → 409 no campo, apontando a empresa existente", async () => {
    const [, lookup] = queueQueries(
      { data: null, error: CNPJ_CONFLICT },
      { data: { id: CUSTOMER_ID }, error: null }
    );

    const response = await post({ legal_name: "Empresa Alfa", cnpj: "11.222.333/0001-81" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      message: "Já existe empresa ativa com este CNPJ.",
      errors: { cnpj: ["Já existe empresa ativa com este CNPJ."] },
      existing: { id: CUSTOMER_ID },
    });
    expect(callsOf(lookup, "eq")).toEqual([["cnpj", "11222333000181"]]);
    expect(callsOf(lookup, "is")).toEqual([["archived_at", null]]);
  });

  it("409 de CNPJ continua 409 quando a leitura da empresa existente falha", async () => {
    queueQueries(
      { data: null, error: CNPJ_CONFLICT },
      { data: null, error: { code: "57014", message: "canceling statement" } }
    );

    const response = await post({ legal_name: "Empresa Alfa", cnpj: "11.222.333/0001-81" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors).toEqual({ cnpj: ["Já existe empresa ativa com este CNPJ."] });
    expect(body).not.toHaveProperty("existing");
  });

  it("erro inesperado responde 500 genérico e loga", async () => {
    queueQueries({
      data: null,
      error: { code: "42501", message: "permission denied for table customers" },
    });

    const response = await post({ legal_name: "Empresa Alfa" });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, message: "Não foi possível concluir a operação." });
    expect(console.error).toHaveBeenCalled();
  });
});
