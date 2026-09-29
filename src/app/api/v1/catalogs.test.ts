// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, catalogMock, productsMock, teamMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  catalogMock: vi.fn(),
  productsMock: vi.fn(),
  teamMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));
vi.mock("@/features/tickets/queries/get-ticket-catalog", () => ({ getTicketCatalog: catalogMock }));
vi.mock("@/features/products/queries/get-products", () => ({ getProducts: productsMock }));
vi.mock("@/features/tickets/queries/get-assignable-users", () => ({ getAssignableUsers: teamMock }));

import { GET as products } from "@/app/api/v1/products/route";
import { GET as slaPolicies } from "@/app/api/v1/sla-policies/route";
import { GET as ticketCategories } from "@/app/api/v1/ticket-categories/route";
import { GET as ticketStatuses } from "@/app/api/v1/ticket-statuses/route";
import { GET as users } from "@/app/api/v1/users/route";
import {
  assignableUserSchema,
  listOf,
  productSchema,
  slaPolicySchema,
  ticketCategorySchema,
  ticketStatusSchema,
} from "@/lib/api/v1/catalog";

const QUEUE = { id: "q1", name: "ERP", niche: "varejo", color: "blue", archived_at: null };
const CATALOG = {
  statuses: [
    { key: "em_triagem", label: "Em triagem", color: "blue", position: 2, sla_mode: "running", is_terminal: false },
    { key: "novo", label: "Novo", color: "slate", position: 1, sla_mode: "running", is_terminal: false },
    { key: "fechado", label: "Fechado", color: "gray", position: 9, sla_mode: "stopped", is_terminal: true },
  ],
  transitions: [
    { from_status: "novo", to_status: "em_triagem" },
    { from_status: "novo", to_status: "fechado" },
    { from_status: "em_triagem", to_status: "fechado" },
  ],
  // Como o banco entrega: rank crescente, baixa=1 … critica=4.
  priorities: [
    { priority: "baixa", rank: 1, first_response_minutes: 480, resolution_minutes: 4320, warn_pct: 80 },
    { priority: "critica", rank: 4, first_response_minutes: 30, resolution_minutes: 240, warn_pct: 80 },
  ],
  products: [QUEUE],
  categories: [{ id: "c1", name: "Notas", product_id: "q1", parent_id: null, archived_at: null }],
};

let ip = 0;
const call = <C,>(handler: (r: Request, c: C) => Promise<Response>) => {
  ip += 1;
  return handler(
    new Request("http://crm.test/api/v1/x", {
      headers: { authorization: "Bearer crmsuporte_x", "x-forwarded-for": `192.0.2.${ip}` },
    }),
    { params: Promise.resolve({}) } as C
  );
};

function tokenWith(scopes: string[]) {
  const row = {
    id: "tok-1",
    name: "IA",
    token_prefix: "crmsuporte_a",
    scopes,
    actor_type: "ai",
    rate_limit_per_min: 300,
    expires_at: null,
    last_used_at: new Date().toISOString(),
  };
  adminClientMock.mockReturnValue({
    from: (table: string) =>
      table === "api_tokens"
        ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }
        : { insert: async () => ({ error: null }) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenWith(["catalog:read"]);
  catalogMock.mockResolvedValue(CATALOG);
  productsMock.mockResolvedValue([QUEUE]);
  teamMock.mockResolvedValue([
    { id: "u1", name: "Ana", avatar_color: "blue", avatar_url: null, is_active: true },
    { id: "u2", name: "Bruno", avatar_color: "red", avatar_url: null, is_active: false },
  ]);
});

describe("catálogos da API v1", () => {
  it("cada rota responde no schema publicado no OpenAPI", async () => {
    const cases = [
      [products, productSchema],
      [ticketCategories, ticketCategorySchema],
      [ticketStatuses, ticketStatusSchema],
      [slaPolicies, slaPolicySchema],
      [users, assignableUserSchema],
    ] as const;
    for (const [handler, schema] of cases) {
      const response = await call(handler);
      expect(response.status).toBe(200);
      expect(listOf(schema).safeParse(await response.json()).success).toBe(true);
    }
  });

  it("status na ordem do quadro, cada um com os destinos permitidos", async () => {
    const body = await (await call(ticketStatuses)).json();

    expect(body.data.map((s: { key: string }) => s.key)).toEqual(["novo", "em_triagem", "fechado"]);
    expect(body.data[0].transitions).toEqual(["em_triagem", "fechado"]);
    expect(body.data[2].transitions).toEqual([]);
    expect(body.data[0]).not.toHaveProperty("color");
  });

  it("users: só os ativos, sem e-mail nem foto", async () => {
    const body = await (await call(users)).json();

    expect(body.data).toEqual([{ id: "u1", name: "Ana" }]);
  });

  it("filas e categorias sem campos de tela", async () => {
    expect((await (await call(products)).json()).data).toEqual([{ id: "q1", name: "ERP", niche: "varejo" }]);
    expect((await (await call(ticketCategories)).json()).data[0]).not.toHaveProperty("archived_at");
  });

  it("sla-policies: da menos urgente para a mais, com o rank maior = mais urgente", async () => {
    const body = await (await call(slaPolicies)).json();

    expect(body.data.map((p: { priority: string }) => p.priority)).toEqual(["baixa", "critica"]);
    expect(body.data.at(-1)).toMatchObject({ priority: "critica", rank: 4 });
  });

  it("sem catalog:read é 403 em toda rota de catálogo, sem tocar a query", async () => {
    const cases = [
      [products, productsMock],
      [ticketCategories, catalogMock],
      [ticketStatuses, catalogMock],
      [slaPolicies, catalogMock],
      [users, teamMock],
    ] as const;
    for (const scopes of [[], ["tickets:read"]]) {
      tokenWith(scopes);
      for (const [handler, query] of cases) {
        const response = await call(handler);
        const body = await response.json();
        expect(response.status).toBe(403);
        expect(body.error).toMatchObject({ code: "insufficient_scope", required: ["catalog:read"] });
        expect(query).not.toHaveBeenCalled();
      }
    }
  });

  it.each([
    ["status (statuses)", () => ticketStatuses, { statuses: null }],
    ["status (transitions)", () => ticketStatuses, { transitions: null }],
    ["categorias", () => ticketCategories, { categories: null }],
    ["SLA", () => slaPolicies, { priorities: null }],
  ])("leitura de %s que falhou é 503, nunca lista vazia", async (_label, handler, broken) => {
    catalogMock.mockResolvedValue({ ...CATALOG, ...broken });

    const response = await call(handler());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(body.error.code).toBe("unavailable");
    expect(body).not.toHaveProperty("data");
  });

  it("filas e equipe que falharam são 503; a falha de uma parte não derruba as outras", async () => {
    productsMock.mockResolvedValue(null);
    teamMock.mockResolvedValue(null);
    catalogMock.mockResolvedValue({ ...CATALOG, categories: null });

    expect((await call(products)).status).toBe(503);
    expect((await call(users)).status).toBe(503);
    expect((await call(ticketStatuses)).status).toBe(200);
  });
});
