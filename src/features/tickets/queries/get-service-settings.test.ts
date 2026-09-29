import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { getServiceSettings } from "@/features/tickets/queries/get-service-settings";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. O mesmo de get-ticket-catalog.test.ts.
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
type Table = "products" | "ticket_categories" | "sla_policies" | "ticket_statuses";

const ok = (data: unknown[]) => ({ data, error: null });
const failure = () => ({ data: null, error: { code: "57014", message: "timeout" } });

const ERP = {
  id: "c9f0f895-fb98-4b91-b6c4-2d3e4f5a6b7c",
  name: "ERP",
  niche: "Varejo",
  color: "sky",
  archived_at: null,
};
const FOLHA = {
  id: "a87ff679-a2f3-4e71-8c9d-0e1f2a3b4c5d",
  name: "Folha",
  niche: null,
  color: "rose",
  archived_at: "2026-09-20T12:00:00.123456+00:00",
};
const PDV = {
  id: "e4da3b7f-bbce-4345-9c2d-6e7f8a9b0c1d",
  name: "PDV",
  niche: null,
  color: "emerald",
  archived_at: null,
};
const AGENDA = {
  id: "1679091c-5a88-4faf-9b3c-2d1e0f9a8b7c",
  name: "Agenda",
  niche: null,
  color: "violet",
  archived_at: "2026-09-01T08:00:00+00:00",
};

// Como o banco devolve: por nome, arquivadas misturadas às ativas.
const PRODUCTS_BY_NAME = [AGENDA, ERP, FOLHA, PDV];

// Categoria geral, categoria e subcategoria de fila, e uma arquivada.
const CATEGORIES = [
  {
    id: "c81e728d-9d4c-4f63-8a2b-3c4d5e6f7a8b",
    name: "Estoque",
    product_id: ERP.id,
    parent_id: null,
    archived_at: null,
  },
  {
    id: "8f14e45f-ceea-467a-9575-8b7c6d5e4f3a",
    name: "Férias",
    product_id: FOLHA.id,
    parent_id: null,
    archived_at: "2026-09-20T12:00:00+00:00",
  },
  {
    id: "eccbc87e-4b5c-4e2f-9a8b-7c6d5e4f3a2b",
    name: "Inventário",
    product_id: ERP.id,
    parent_id: "c81e728d-9d4c-4f63-8a2b-3c4d5e6f7a8b",
    archived_at: null,
  },
  {
    id: "d3d9446e-02a5-4c41-8b3e-5f6a7b8c9d0e",
    name: "Nota fiscal",
    product_id: null,
    parent_id: null,
    archived_at: null,
  },
];

const POLICIES = [
  { priority: "baixa", rank: 1, first_response_minutes: 480, resolution_minutes: 2880, warn_pct: 80 },
  { priority: "alta", rank: 3, first_response_minutes: 60, resolution_minutes: 480, warn_pct: 75 },
  { priority: "critica", rank: 4, first_response_minutes: 15, resolution_minutes: 240, warn_pct: 70 },
];

const STATUSES = [
  { key: "novo", label: "Novo", color: "sky", position: 1, sla_mode: "running", is_terminal: false },
  {
    key: "aguardando_cliente",
    label: "Com o cliente",
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

function mockSettings(overrides: Partial<Record<Table, unknown>> = {}) {
  const results: Record<Table, unknown> = {
    products: ok(PRODUCTS_BY_NAME),
    ticket_categories: ok(CATEGORIES),
    sla_policies: ok(POLICIES),
    ticket_statuses: ok(STATUSES),
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
  products: [ERP, PDV, AGENDA, FOLHA],
  categories: CATEGORIES,
  policies: POLICIES,
  statuses: STATUSES,
};

beforeEach(() => {
  fromMock.mockReset();
  envMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getServiceSettings", () => {
  it("monta as quatro partes, com as filas ativas primeiro e cada grupo por nome", async () => {
    mockSettings();

    expect(await getServiceSettings()).toEqual(FULL);
  });

  it("pede colunas explícitas (grants por coluna) e a ordem, sem filtrar as arquivadas", async () => {
    // A lista exata de chamadas prova que nada corta archived_at: o catálogo do
    // "Novo ticket" corta as arquivadas, e aqui é onde se reativa.
    const calls = mockSettings();

    await getServiceSettings();

    expect(calls.products).toEqual([
      ["select", "id, name, niche, color, archived_at"],
      ["order", "name", { ascending: true }],
      ["order", "id", { ascending: true }],
    ]);
    expect(calls.ticket_categories).toEqual([
      ["select", "id, name, product_id, parent_id, archived_at"],
      ["order", "name", { ascending: true }],
      ["order", "id", { ascending: true }],
    ]);
    expect(calls.sla_policies).toEqual([
      ["select", "priority, rank, first_response_minutes, resolution_minutes, warn_pct"],
      ["order", "rank", { ascending: true }],
    ]);
    expect(calls.ticket_statuses).toEqual([
      ["select", "key, label, color, position, sla_mode, is_terminal"],
      ["order", "position", { ascending: true }],
    ]);
  });

  it("fila arquivada com nome repetido fica depois da ativa, na ordem do banco", async () => {
    const archivedErp = { ...ERP, id: "45c48cce-2e2d-4fbd-8a1f-0b1c2d3e4f5a", archived_at: FOLHA.archived_at };
    mockSettings({ products: ok([archivedErp, ERP, AGENDA]) });

    const { products } = await getServiceSettings();

    expect(products).toEqual([ERP, archivedErp, AGENDA]);
  });

  it.each([
    ["products", "products"],
    ["ticket_categories", "categories"],
    ["sla_policies", "policies"],
    ["ticket_statuses", "statuses"],
  ] as const)("erro em %s deixa só %s null; as outras seguem preenchidas", async (table, part) => {
    mockSettings({ [table]: failure() });

    const settings = await getServiceSettings();

    expect(settings).toEqual({ ...FULL, [part]: null });
    expect(console.error).toHaveBeenCalled();
  });

  it("parte vazia continua [], não vira null", async () => {
    mockSettings({
      products: ok([]),
      ticket_categories: ok([]),
      sla_policies: ok([]),
      ticket_statuses: ok([]),
    });

    expect(await getServiceSettings()).toEqual({
      products: [],
      categories: [],
      policies: [],
      statuses: [],
    });
  });

  it.each([
    ["status desconhecido", "ticket_statuses", "statuses", { ...STATUSES[0], key: "arquivado" }],
    ["sla_mode desconhecido", "ticket_statuses", "statuses", { ...STATUSES[0], sla_mode: "frozen" }],
    ["prioridade desconhecida", "sla_policies", "policies", { ...POLICIES[0], priority: "urgente" }],
  ] as const)("linha com %s anula a parte inteira", async (_, table, part, badRow) => {
    const valid = { ticket_statuses: STATUSES, sla_policies: POLICIES };
    // As linhas boas continuam na parte: uma só fora da allowlist basta.
    mockSettings({ [table]: ok([...valid[table], badRow]) });

    const settings = await getServiceSettings();

    expect(settings).toEqual({ ...FULL, [part]: null });
    expect(console.error).toHaveBeenCalled();
  });

  it("coluna a mais na linha não vaza para a tela", async () => {
    mockSettings({
      products: ok([{ ...ERP, created_at: "2026-09-01T00:00:00+00:00" }]),
      ticket_statuses: ok([{ ...STATUSES[0], created_at: "2026-09-01T00:00:00+00:00" }]),
    });

    const { products, statuses } = await getServiceSettings();

    expect(products).toEqual([ERP]);
    expect(statuses).toEqual([STATUSES[0]]);
  });

  it("exceção no meio da leitura deixa todas as partes null", async () => {
    fromMock.mockImplementation(() => {
      throw new Error("fetch failed");
    });

    expect(await getServiceSettings()).toEqual({
      products: null,
      categories: null,
      policies: null,
      statuses: null,
    });
    expect(console.error).toHaveBeenCalledWith("getServiceSettings threw", expect.any(Error));
  });

  it("sem Supabase configurado, todas as partes são null", async () => {
    envMock.mockReturnValue(false);

    expect(await getServiceSettings()).toEqual({
      products: null,
      categories: null,
      policies: null,
      statuses: null,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
