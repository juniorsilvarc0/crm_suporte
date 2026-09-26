import { beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, adminEnvMock, catalogMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  adminEnvMock: vi.fn(),
  catalogMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: adminEnvMock,
}));
// A leitura de cada parte tem o próprio contrato (get-ticket-catalog.ts); aqui
// vale o que a rota faz com as partes.
vi.mock("@/features/tickets/queries/get-ticket-catalog", () => ({
  getTicketCatalog: catalogMock,
}));

import { GET } from "@/app/api/tickets/catalog/route";
import type { TicketCatalog } from "@/features/tickets/types";

const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";

const catalog: TicketCatalog = {
  statuses: [
    {
      key: "novo",
      label: "Novo",
      color: "sky",
      position: 1,
      sla_mode: "running",
      is_terminal: false,
    },
  ],
  transitions: [{ from_status: "novo", to_status: "em_atendimento" }],
  priorities: [
    {
      priority: "alta",
      rank: 3,
      first_response_minutes: 60,
      resolution_minutes: 480,
      warn_pct: 80,
    },
  ],
  products: [{ id: PRODUCT_ID, name: "Emissor fiscal", niche: null, color: "slate", archived_at: null }],
  categories: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Nota rejeitada",
      product_id: PRODUCT_ID,
      parent_id: null,
      archived_at: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  userMock.mockResolvedValue({ viewer: { id: "11111111-1111-4111-8111-111111111111" } });
  adminEnvMock.mockReturnValue(true);
  catalogMock.mockResolvedValue(catalog);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/tickets/catalog", () => {
  it("recusa sem usuário ativo antes de ler o catálogo", async () => {
    userMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(catalogMock).not.toHaveBeenCalled();
  });

  it("sem o Supabase admin configurado → 500 sem ler", async () => {
    adminEnvMock.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(500);
    expect((await response.json()).ok).toBe(false);
    expect(catalogMock).not.toHaveBeenCalled();
  });

  it("devolve as cinco partes", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...catalog });
  });

  it("uma parte que falhou vem null e não derruba as outras (200)", async () => {
    catalogMock.mockResolvedValue({ ...catalog, transitions: null });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.transitions).toBeNull();
    expect(json.statuses).toEqual(catalog.statuses);
    expect(json.products).toEqual(catalog.products);
  });

  it("partes vazias não são falha: [] continua [] (200)", async () => {
    catalogMock.mockResolvedValue({
      statuses: [],
      transitions: [],
      priorities: [],
      products: [],
      categories: [],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      statuses: [],
      transitions: [],
      priorities: [],
      products: [],
      categories: [],
    });
  });

  it("nenhuma parte lida → 500 logado", async () => {
    catalogMock.mockResolvedValue({
      statuses: null,
      transitions: null,
      priorities: null,
      products: null,
      categories: null,
    });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Não foi possível carregar o catálogo dos tickets.",
    });
    expect(console.error).toHaveBeenCalled();
  });
});
