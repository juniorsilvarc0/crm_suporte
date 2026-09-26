import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import {
  CONTACT_LIST_SELECT,
  getContactsPage,
  parseContactListParams,
  type ContactListParams,
} from "@/features/contacts/queries/get-contacts-page";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. Não tem `.or()`: se a busca um dia montar um, o teste quebra.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "ilike", "eq", "is", "not", "order", "range"]) {
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

const customer = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  legal_name: "Padaria S. João Ltda",
  trade_name: "Padaria São João",
  cnpj: "12ABC34501DE35",
  contract_status: "suspenso",
  archived_at: null,
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Maria Souza",
  phone: "5527999990000",
  last_message_at: "2026-09-25T10:00:00Z",
  customer: null,
  ...overrides,
});

const params = (overrides: Partial<ContactListParams> = {}): ContactListParams => ({
  q: "",
  empresa: "todos",
  page: 1,
  ...overrides,
});

const ok = (data: unknown[], count = data.length) => ({ data, error: null, count });

const filters = (calls: Call[]) =>
  calls.filter(([method]) => ["ilike", "eq", "is", "not"].includes(method));

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseContactListParams", () => {
  it("aceita só os filtros de empresa da allowlist; o resto vira 'todos'", () => {
    for (const empresa of ["com", "sem"]) {
      expect(parseContactListParams({ empresa }).empresa).toBe(empresa);
    }
    for (const empresa of ["", "COM", "algumas", "todos", undefined]) {
      expect(parseContactListParams({ empresa }).empresa).toBe("todos");
    }
  });

  it("usa o primeiro valor quando o parâmetro se repete", () => {
    expect(parseContactListParams({ empresa: ["sem", "com"], page: ["3", "9"] })).toEqual({
      q: "",
      empresa: "sem",
      page: 3,
    });
  });

  it("página inválida vira 1", () => {
    for (const page of [undefined, "", "0", "-3", "abc", "99999999999999999999"]) {
      expect(parseContactListParams({ page }).page).toBe(1);
    }
    expect(parseContactListParams({ page: "4" }).page).toBe(4);
  });

  it("apara o termo e corta em 100 caracteres", () => {
    expect(parseContactListParams({ q: "  maria  " }).q).toBe("maria");
    expect(parseContactListParams({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
});

describe("getContactsPage", () => {
  it("texto vira um ilike por token em search_name, só entre ativos, por última mensagem", async () => {
    const [calls] = queueQueries(ok([]));

    await getContactsPage(params({ q: "José  da Conceição" }));

    expect(fromMock).toHaveBeenCalledWith("contacts");
    expect(calls).toEqual([
      ["select", CONTACT_LIST_SELECT, { count: "exact", head: false }],
      ["is", "archived_at", null],
      ["ilike", "search_name", "%jose%"],
      ["ilike", "search_name", "%da%"],
      ["ilike", "search_name", "%conceicao%"],
      ["order", "last_message_at", { ascending: false, nullsFirst: false }],
      ["order", "name", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["range", 0, 24],
    ]);
  });

  it.each([
    ["(27) 99999-0000", "%27999990000%"],
    ["+55 27 99999.0000", "%27999990000%"],
    ["9999", "%9999%"],
    ["5527", "%5527%"],
  ])("só dígitos (%s) vão para normalized_phone, sem DDI", async (q, pattern) => {
    const [calls] = queueQueries(ok([]));

    await getContactsPage(params({ q }));

    expect(filters(calls)).toEqual([
      ["is", "archived_at", null],
      ["ilike", "normalized_phone", pattern],
    ]);
  });

  it.each([
    ["123", "%123%"],
    ["maria 2799", "%maria%"],
  ])("menos de 4 dígitos, ou dígito com texto (%s), busca pelo nome", async (q, first) => {
    const [calls] = queueQueries(ok([]));

    await getContactsPage(params({ q }));

    const ilikes = calls.filter(([method]) => method === "ilike");
    expect(ilikes[0]).toEqual(["ilike", "search_name", first]);
    expect(ilikes.every(([, column]) => column === "search_name")).toBe(true);
  });

  it("termo sem token útil não vira filtro", async () => {
    const [calls] = queueQueries(ok([]));

    await getContactsPage(params({ q: " , ( ) % " }));

    expect(calls.filter(([method]) => method === "ilike")).toEqual([]);
  });

  it("o select não cita support_contracts, search_name nem *", () => {
    expect(CONTACT_LIST_SELECT).not.toMatch(/support_contracts|search_name|normalized_phone|\*/);
  });

  it.each([
    ["com", [["not", "customer_id", "is", null]]],
    ["sem", [["is", "customer_id", null]]],
    ["todos", []],
  ] as const)("empresa=%s aplica o filtro certo", async (empresa, expected) => {
    const [calls] = queueQueries(ok([]));

    await getContactsPage(params({ empresa }));

    expect(filters(calls)).toEqual([["is", "archived_at", null], ...expected]);
  });

  it("pagina de 25 em 25", async () => {
    const [calls] = queueQueries(ok([row()], 80));

    const result = await getContactsPage(params({ page: 3 }));

    expect(calls.at(-1)).toEqual(["range", 50, 74]);
    expect(result).toMatchObject({ page: 3, pageSize: 25, total: 80, pageCount: 4, failed: false });
  });

  it("monta cada item campo a campo; empresa vira CustomerSummary", async () => {
    queueQueries(
      ok([
        {
          ...row({ customer: { ...customer(), search_name: "padaria", monthly_amount: 999 } }),
          search_name: "maria souza",
          normalized_phone: "27999990000",
        },
        row({ id: "p2", customer: customer({ id: "c2", contract_status: "cancelado" }) }),
        row({ id: "p3", name: null, last_message_at: null }),
      ])
    );

    const result = await getContactsPage(params());

    expect(result.items).toEqual([
      { ...row(), customer: customer() },
      row({ id: "p2", customer: { ...customer({ id: "c2" }), contract_status: null } }),
      row({ id: "p3", name: null, last_message_at: null }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/monthly_amount|search_name|normalized_phone/);
  });

  it("erro do banco devolve failed, não lista vazia comum", async () => {
    queueQueries({ data: null, error: { code: "42501", message: "permission denied" }, count: null });

    const result = await getContactsPage(params({ page: 2 }));

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

    expect((await getContactsPage(params())).failed).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("offset igual ao total (206 com lista vazia) abre a última página", async () => {
    const [first, retry] = queueQueries(ok([], 25), ok([row()], 25));

    const result = await getContactsPage(params({ page: 2 }));

    expect(first.at(-1)).toEqual(["range", 25, 49]);
    expect(retry.at(-1)).toEqual(["range", 0, 24]);
    expect(result).toMatchObject({ page: 1, total: 25, pageCount: 1, failed: false });
    expect(result.items).toHaveLength(1);
  });

  it("página além do fim (PGRST103) abre a última página que existe", async () => {
    const [first, head, retry] = queueQueries(
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null },
      { data: null, error: null, count: 30 },
      ok([row()], 30)
    );

    const result = await getContactsPage(params({ q: "maria", empresa: "sem", page: 9 }));

    expect(first.at(-1)).toEqual(["range", 200, 224]);
    // A contagem repete o recorte, sem ordem nem página.
    expect(head).toEqual([
      ["select", CONTACT_LIST_SELECT, { count: "exact", head: true }],
      ["is", "archived_at", null],
      ["ilike", "search_name", "%maria%"],
      ["is", "customer_id", null],
    ]);
    expect(retry.at(-1)).toEqual(["range", 25, 49]);
    expect(result).toMatchObject({ page: 2, total: 30, pageCount: 2, failed: false });
    expect(result.items).toHaveLength(1);
  });

  it("se a contagem de socorro falha, a página é failed", async () => {
    queueQueries(
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null },
      { data: null, error: { code: "57014", message: "timeout" }, count: null }
    );

    expect((await getContactsPage(params({ page: 5 }))).failed).toBe(true);
  });

  it("exceção vira failed com a página pedida", async () => {
    fromMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(await getContactsPage(params({ page: 3 }))).toMatchObject({ page: 3, failed: true });
  });
});
