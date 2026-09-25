import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock, adminClientMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  adminClientMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: requireUserMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { GET } from "@/app/api/leads/[id]/history/route";

const VALID_ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";

function makeSupabase({ historyError = null }: { historyError?: { message: string } | null } = {}) {
  const order = vi.fn(async () => ({
    data: historyError
      ? null
      : [
          {
            id: "history-1",
            from_stage: "novo",
            to_stage: "agendado",
            occurred_at: "2026-08-10T19:32:00.000Z",
          },
        ],
    error: historyError,
  }));
  const eq = vi.fn(() => ({ order }));
  const historySelect = vi.fn(() => ({ eq }));
  const columnsSelect = vi.fn(async () => ({
    data: [
      { key: "novo", label: "Novo contato" },
      { key: "agendado", label: "Consulta agendada" },
    ],
    error: null,
  }));
  const from = vi.fn((table: string) => {
    if (table === "deal_stage_history") return { select: historySelect };
    if (table === "board_columns") return { select: columnsSelect };
    throw new Error(`Tabela inesperada: ${table}`);
  });

  return { from, historySelect, eq, order, columnsSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ viewer: { id: "user-1" } });
});

describe("GET /api/leads/[id]/history", () => {
  it("recusa usuário sem acesso antes de consultar o banco", async () => {
    requireUserMock.mockResolvedValue({
      error: new Response(JSON.stringify({ ok: false }), { status: 403 }),
    });

    const response = await GET(new Request(`http://x/api/leads/${VALID_ID}/history`), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("consulta somente o lead solicitado e devolve mudanças recentes primeiro", async () => {
    const supabase = makeSupabase();
    adminClientMock.mockReturnValue(supabase);

    const response = await GET(new Request(`http://x/api/leads/${VALID_ID}/history`), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(response.status).toBe(200);
    expect(supabase.eq).toHaveBeenCalledWith("lead_id", VALID_ID);
    expect(supabase.order).toHaveBeenCalledWith("occurred_at", { ascending: false });
    expect(await response.json()).toEqual({
      ok: true,
      items: [
        {
          id: "history-1",
          fromLabel: "Novo contato",
          toLabel: "Consulta agendada",
          occurredAt: "2026-08-10T19:32:00.000Z",
        },
      ],
    });
  });

  it("não expõe detalhes internos quando a consulta falha", async () => {
    const supabase = makeSupabase({ historyError: { message: "segredo interno" } });
    adminClientMock.mockReturnValue(supabase);

    const response = await GET(new Request(`http://x/api/leads/${VALID_ID}/history`), {
      params: Promise.resolve({ id: VALID_ID }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Não foi possível carregar o histórico.",
    });
  });
});
