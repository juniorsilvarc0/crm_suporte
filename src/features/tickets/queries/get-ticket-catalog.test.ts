import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock, getProductsMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
  getProductsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

vi.mock("@/features/products/queries/get-products", () => ({
  getProducts: getProductsMock,
}));

import { getTicketCatalog } from "@/features/tickets/queries/get-ticket-catalog";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. O mesmo de get-tickets-page.test.ts.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "ilike", "eq", "neq", "is", "not", "order", "range", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

// As quatro leituras rodam em paralelo: cada from() recebe o resultado pela
// tabela, não pela ordem da chamada.
type Table = "ticket_statuses" | "ticket_status_transitions" | "sla_policies" | "ticket_categories";

const ok = (data: unknown[]) => ({ data, error: null });
const failure = () => ({ data: null, error: { code: "57014", message: "timeout" } });

const STATUSES = [
  { key: "novo", label: "Novo", color: "sky", position: 1, sla_mode: "running", is_terminal: false },
  {
    key: "aguardando_cliente",
    label: "Aguardando cliente",
    color: "amber",
    position: 4,
    sla_mode: "paused",
    is_terminal: false,
  },
  {
    key: "cancelado",
    label: "Cancelado",
    color: "gray",
    position: 8,
    sla_mode: "stopped",
    is_terminal: true,
  },
];

const TRANSITIONS = [
  { from_status: "novo", to_status: "em_triagem" },
  { from_status: "novo", to_status: "cancelado" },
];

const PRIORITIES = [
  { priority: "baixa", rank: 1, first_response_minutes: 480, resolution_minutes: 2880, warn_pct: 80 },
  { priority: "critica", rank: 4, first_response_minutes: 15, resolution_minutes: 240, warn_pct: 70 },
];

const PRODUCTS = [
  { id: "c9f0f895-fb98-4b91-b6c4-2d3e4f5a6b7c", name: "ERP", niche: null, color: "sky", archived_at: null },
];

const CATEGORIES = [
  {
    id: "d3d9446e-02a5-4c41-8b3e-5f6a7b8c9d0e",
    name: "Nota fiscal",
    product_id: null,
    parent_id: null,
    archived_at: null,
  },
];

function mockCatalog(overrides: Partial<Record<Table, unknown>> = {}) {
  const results: Record<Table, unknown> = {
    ticket_statuses: ok(STATUSES),
    ticket_status_transitions: ok(TRANSITIONS),
    sla_policies: ok(PRIORITIES),
    ticket_categories: ok(CATEGORIES),
    ...overrides,
  };
  const calls: Partial<Record<Table, Call[]>> = {};
  fromMock.mockImplementation((table: Table) => {
    const query = fakeQuery(results[table]);
    calls[table] = query.calls;
    return query.builder;
  });
  return calls;
}

const FULL = {
  statuses: STATUSES,
  transitions: TRANSITIONS,
  priorities: PRIORITIES,
  products: PRODUCTS,
  categories: CATEGORIES,
};

beforeEach(() => {
  fromMock.mockReset();
  envMock.mockReturnValue(true);
  getProductsMock.mockReset();
  getProductsMock.mockResolvedValue(PRODUCTS);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getTicketCatalog", () => {
  it("monta as cinco partes", async () => {
    mockCatalog();

    expect(await getTicketCatalog()).toEqual(FULL);
  });

  it.each([
    ["ticket_statuses", "statuses"],
    ["ticket_status_transitions", "transitions"],
    ["sla_policies", "priorities"],
    ["ticket_categories", "categories"],
  ] as const)("erro em %s deixa só %s null; as outras seguem preenchidas", async (table, part) => {
    mockCatalog({ [table]: failure() });

    const catalog = await getTicketCatalog();

    expect(catalog).toEqual({ ...FULL, [part]: null });
    expect(console.error).toHaveBeenCalled();
  });

  it("filas que não carregaram (getProducts null) deixam só products null", async () => {
    mockCatalog();
    getProductsMock.mockResolvedValue(null);

    expect(await getTicketCatalog()).toEqual({ ...FULL, products: null });
  });

  it("parte vazia continua [], não vira null", async () => {
    mockCatalog({
      ticket_statuses: ok([]),
      ticket_status_transitions: ok([]),
      sla_policies: ok([]),
      ticket_categories: ok([]),
    });
    getProductsMock.mockResolvedValue([]);

    expect(await getTicketCatalog()).toEqual({
      statuses: [],
      transitions: [],
      priorities: [],
      products: [],
      categories: [],
    });
  });

  it.each([
    ["status desconhecido", "ticket_statuses", "statuses", { ...STATUSES[0], key: "arquivado" }],
    ["sla_mode desconhecido", "ticket_statuses", "statuses", { ...STATUSES[0], sla_mode: "frozen" }],
    [
      "prioridade desconhecida",
      "sla_policies",
      "priorities",
      { ...PRIORITIES[0], priority: "urgente" },
    ],
    [
      "destino desconhecido",
      "ticket_status_transitions",
      "transitions",
      { from_status: "novo", to_status: "arquivado" },
    ],
  ] as const)("linha com %s anula a parte inteira", async (_, table, part, badRow) => {
    const valid: Record<Table, unknown[]> = {
      ticket_statuses: STATUSES,
      ticket_status_transitions: TRANSITIONS,
      sla_policies: PRIORITIES,
      ticket_categories: CATEGORIES,
    };
    // As linhas boas continuam na parte: uma só fora da allowlist basta.
    mockCatalog({ [table]: ok([...valid[table], badRow]) });

    const catalog = await getTicketCatalog();

    expect(catalog).toEqual({ ...FULL, [part]: null });
    expect(console.error).toHaveBeenCalled();
  });

  it("categorias pedem só as não arquivadas", async () => {
    const calls = mockCatalog();

    await getTicketCatalog();

    expect(fromMock).toHaveBeenCalledWith("ticket_categories");
    expect(calls.ticket_categories).toContainEqual(["is", "archived_at", null]);
  });

  it("transições embaralhadas saem na ordem de position da origem e depois do destino", async () => {
    mockCatalog({
      ticket_status_transitions: ok([
        { from_status: "em_atendimento", to_status: "resolvido" },
        { from_status: "resolvido", to_status: "fechado" },
        { from_status: "novo", to_status: "cancelado" },
        { from_status: "em_atendimento", to_status: "aguardando_cliente" },
        { from_status: "novo", to_status: "em_triagem" },
        { from_status: "resolvido", to_status: "em_atendimento" },
        { from_status: "novo", to_status: "em_atendimento" },
      ]),
    });

    const { transitions } = await getTicketCatalog();

    expect(transitions).toEqual([
      { from_status: "novo", to_status: "em_triagem" },
      { from_status: "novo", to_status: "em_atendimento" },
      { from_status: "novo", to_status: "cancelado" },
      { from_status: "em_atendimento", to_status: "aguardando_cliente" },
      { from_status: "em_atendimento", to_status: "resolvido" },
      { from_status: "resolvido", to_status: "em_atendimento" },
      { from_status: "resolvido", to_status: "fechado" },
    ]);
  });

  it("sem Supabase configurado, todas as partes são null", async () => {
    envMock.mockReturnValue(false);

    expect(await getTicketCatalog()).toEqual({
      statuses: null,
      transitions: null,
      priorities: null,
      products: null,
      categories: null,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
