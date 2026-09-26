import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/supabase/types";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import {
  CUSTOMER_LIST_SELECT,
  getCustomersPage,
  parseCustomerListParams,
  searchCustomerOptions,
} from "@/features/customers/queries/get-customers-page";
import type { CustomerListParams } from "@/features/customers/types";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. Não tem `.or()`: se a busca um dia montar um, o teste quebra.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "ilike", "eq", "is", "not", "order", "range", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

function queueQueries(...results: unknown[]) {
  const queries = results.map(fakeQuery);
  for (const query of queries) fromMock.mockReturnValueOnce(query.builder);
  return queries.map((query) => query.calls);
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  legal_name: "Padaria S. João Ltda",
  trade_name: "Padaria São João",
  cnpj: "12ABC34501DE35",
  contract_status: "ativo",
  archived_at: null,
  created_at: "2026-09-25T10:00:00Z",
  ...overrides,
});

const params = (overrides: Partial<CustomerListParams> = {}): CustomerListParams => ({
  q: "",
  situacao: "todas",
  page: 1,
  ...overrides,
});

const ok = (data: unknown[], count = data.length) => ({ data, error: null, count });

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseCustomerListParams", () => {
  it("aceita só as situações da allowlist; o resto vira 'todas'", () => {
    for (const situacao of ["ativo", "suspenso", "encerrado", "sem", "arquivadas"]) {
      expect(parseCustomerListParams({ situacao }).situacao).toBe(situacao);
    }
    for (const situacao of ["", "ATIVO", "cancelado", "todas", undefined]) {
      expect(parseCustomerListParams({ situacao }).situacao).toBe("todas");
    }
  });

  it("usa o primeiro valor quando o parâmetro se repete", () => {
    expect(parseCustomerListParams({ situacao: ["sem", "ativo"], page: ["2", "9"] })).toEqual({
      q: "",
      situacao: "sem",
      page: 2,
    });
  });

  it("página inválida vira 1", () => {
    for (const page of [undefined, "", "0", "-3", "abc", "99999999999999999999"]) {
      expect(parseCustomerListParams({ page }).page).toBe(1);
    }
    expect(parseCustomerListParams({ page: "4" }).page).toBe(4);
  });

  it("apara o termo e corta em 100 caracteres", () => {
    expect(parseCustomerListParams({ q: "  padaria  " }).q).toBe("padaria");
    expect(parseCustomerListParams({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
});

describe("getCustomersPage", () => {
  it("busca com um ilike por token em search_name, só entre ativas, por nome", async () => {
    const [calls] = queueQueries(ok([]));

    await getCustomersPage(params({ q: "Padaria São João" }));

    expect(fromMock).toHaveBeenCalledWith("customers");
    expect(calls).toEqual([
      ["select", CUSTOMER_LIST_SELECT, { count: "exact", head: false }],
      ["ilike", "search_name", "%padaria%"],
      ["ilike", "search_name", "%sao%"],
      ["ilike", "search_name", "%joao%"],
      ["is", "archived_at", null],
      ["order", "search_name", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["range", 0, 24],
    ]);
  });

  it("termo sem token útil não vira filtro", async () => {
    const [calls] = queueQueries(ok([]));

    await getCustomersPage(params({ q: " , ( ) % " }));

    expect(calls.filter(([method]) => method === "ilike")).toEqual([]);
  });

  it("o select não cita support_contracts nem traz search_name", () => {
    expect(CUSTOMER_LIST_SELECT).not.toMatch(/support_contracts|search_name|\*/);
  });

  it.each([
    ["ativo", [["eq", "contract_status", "ativo"], ["is", "archived_at", null]]],
    ["suspenso", [["eq", "contract_status", "suspenso"], ["is", "archived_at", null]]],
    ["encerrado", [["eq", "contract_status", "encerrado"], ["is", "archived_at", null]]],
    ["sem", [["is", "contract_status", null], ["is", "archived_at", null]]],
    ["arquivadas", [["not", "archived_at", "is", null]]],
    ["todas", [["is", "archived_at", null]]],
  ] as const)("situação %s aplica o filtro certo", async (situacao, expected) => {
    const [calls] = queueQueries(ok([]));

    await getCustomersPage(params({ situacao }));

    expect(calls.filter(([method]) => ["eq", "is", "not"].includes(method))).toEqual(expected);
  });

  it("pagina de 25 em 25", async () => {
    const [calls] = queueQueries(ok([row()], 80));

    const result = await getCustomersPage(params({ page: 3 }));

    expect(calls.at(-1)).toEqual(["range", 50, 74]);
    expect(result).toMatchObject({ page: 3, pageSize: 25, total: 80, pageCount: 4, failed: false });
  });

  it("monta cada item campo a campo; selo desconhecido vira null", async () => {
    queueQueries(
      ok([
        { ...row(), search_name: "padaria sao joao", monthly_amount: 999 },
        row({ id: "c2", contract_status: "cancelado" }),
      ])
    );

    const result = await getCustomersPage(params());

    expect(result.items).toEqual([
      {
        id: "c1",
        legal_name: "Padaria S. João Ltda",
        trade_name: "Padaria São João",
        cnpj: "12ABC34501DE35",
        contract_status: "ativo",
        archived_at: null,
        created_at: "2026-09-25T10:00:00Z",
      },
      { ...row({ id: "c2" }), contract_status: null },
    ]);
  });

  it("erro do banco devolve failed, não lista vazia comum", async () => {
    queueQueries({ data: null, error: { code: "42501", message: "permission denied" }, count: null });

    const result = await getCustomersPage(params({ page: 2 }));

    expect(result).toEqual({
      items: [],
      total: 0,
      page: 2,
      pageSize: 25,
      pageCount: 1,
      failed: true,
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("sem Supabase configurado também é failed", async () => {
    envMock.mockReturnValue(false);

    expect((await getCustomersPage(params())).failed).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("página além do fim (PGRST103) abre a última página que existe", async () => {
    const [first, head, retry] = queueQueries(
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null },
      { data: null, error: null, count: 30 },
      ok([row()], 30)
    );

    const result = await getCustomersPage(params({ q: "padaria", situacao: "sem", page: 9 }));

    expect(first.at(-1)).toEqual(["range", 200, 224]);
    // A contagem repete o recorte, sem ordem nem página.
    expect(head).toEqual([
      ["select", CUSTOMER_LIST_SELECT, { count: "exact", head: true }],
      ["ilike", "search_name", "%padaria%"],
      ["is", "contract_status", null],
      ["is", "archived_at", null],
    ]);
    expect(retry.at(-1)).toEqual(["range", 25, 49]);
    expect(result).toMatchObject({ page: 2, total: 30, pageCount: 2, failed: false });
    expect(result.items).toHaveLength(1);
  });

  it("offset igual ao total (206 com lista vazia) abre a última página", async () => {
    const [first, retry] = queueQueries(ok([], 25), ok([row()], 25));

    const result = await getCustomersPage(params({ page: 2 }));

    expect(first.at(-1)).toEqual(["range", 25, 49]);
    expect(retry.at(-1)).toEqual(["range", 0, 24]);
    expect(result).toMatchObject({ page: 1, total: 25, pageCount: 1, failed: false });
    expect(result.items).toHaveLength(1);
  });

  it("base vazia com página além do fim cai na página 1, sem erro", async () => {
    const [, , retry] = queueQueries(
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null },
      { data: null, error: null, count: 0 },
      ok([], 0)
    );

    const result = await getCustomersPage(params({ page: 2 }));

    expect(retry.at(-1)).toEqual(["range", 0, 24]);
    expect(result).toMatchObject({ page: 1, total: 0, failed: false });
  });

  it("se a contagem de socorro falha, a página é failed", async () => {
    queueQueries(
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null },
      { data: null, error: { code: "57014", message: "timeout" }, count: null }
    );

    expect((await getCustomersPage(params({ page: 5 }))).failed).toBe(true);
  });
});

describe("searchCustomerOptions", () => {
  const client = () => ({ from: fromMock }) as unknown as SupabaseClient<Database>;

  it("busca só ativas, por token, com as colunas do resumo", async () => {
    const [calls] = queueQueries(ok([{ ...row(), search_name: "x" }]));

    const items = await searchCustomerOptions(client(), { q: "Padaria 12.ABC", limit: 10 });

    expect(calls).toEqual([
      ["select", "id, legal_name, trade_name, cnpj, contract_status, archived_at"],
      ["is", "archived_at", null],
      ["ilike", "search_name", "%padaria%"],
      ["ilike", "search_name", "%12%"],
      ["ilike", "search_name", "%abc%"],
      ["order", "search_name", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["limit", 10],
    ]);
    expect(items).toEqual([
      {
        id: "c1",
        legal_name: "Padaria S. João Ltda",
        trade_name: "Padaria São João",
        cnpj: "12ABC34501DE35",
        contract_status: "ativo",
        archived_at: null,
      },
    ]);
  });

  it("sem termo, as 20 primeiras por nome; limite fora da faixa é contido", async () => {
    const [none, huge, zero] = queueQueries(ok([]), ok([]), ok([]));

    await searchCustomerOptions(client(), { q: "", limit: 20 });
    await searchCustomerOptions(client(), { q: "", limit: 500 });
    await searchCustomerOptions(client(), { q: "", limit: 0 });

    expect(none.filter(([method]) => method === "ilike")).toEqual([]);
    expect(none.at(-1)).toEqual(["limit", 20]);
    expect(huge.at(-1)).toEqual(["limit", 20]);
    expect(zero.at(-1)).toEqual(["limit", 1]);
  });

  it("lança em erro, para a rota responder 500", async () => {
    const dbError = { code: "57014", message: "timeout" };
    queueQueries({ data: null, error: dbError });

    await expect(searchCustomerOptions(client(), { q: "x1", limit: 20 })).rejects.toBe(dbError);
  });
});
