import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, adminClientMock, insertMock, selectedColumns } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  adminClientMock: vi.fn(),
  insertMock: vi.fn(),
  selectedColumns: [] as string[],
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: adminMock }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "@/app/api/api-tokens/route";
import { API_TOKEN_LIST_COLUMNS } from "@/features/settings/lib/api-token-access";
import { AI_TRIAGE_PRESET } from "@/lib/api/v1/scopes";

function post(body: unknown) {
  return new Request("http://x/api/api-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  selectedColumns.length = 0;
  adminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  // A linha gravada, INTEIRA (com token_hash): o select devolve só o que pediu,
  // como o PostgREST. Um select("*") faria o hash chegar à rota.
  insertMock.mockImplementation((row: Record<string, unknown>) => ({
    select: (columns: string) => {
      selectedColumns.push(columns);
      const stored: Record<string, unknown> = {
        ...row,
        id: "tok-1",
        created_at: "2026-09-29T00:00:00Z",
        last_used_at: null,
        revoked_at: null,
      };
      const data =
        columns === "*"
          ? stored
          : Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, stored[c]]));
      return { single: async () => ({ data, error: null }) };
    },
  }));
  adminClientMock.mockReturnValue({ from: () => ({ insert: insertMock }) });
});

describe("POST /api/api-tokens", () => {
  it("member → 403 sem tocar o banco", async () => {
    adminMock.mockResolvedValue({ error: Response.json({ ok: false }, { status: 403 }) });

    const response = await POST(post({ name: "x" }));

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("grava escopos, tipo e limite do preset da IA; devolve o token uma vez e nunca o hash", async () => {
    const response = await POST(
      post({ name: "IA", scopes: [...AI_TRIAGE_PRESET], actor_type: "ai", rate_limit_per_min: 300 })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ scopes: [...AI_TRIAGE_PRESET], actor_type: "ai", rate_limit_per_min: 300 });
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.token).toMatch(/^crmsuporte_/);
    expect(selectedColumns).toEqual([API_TOKEN_LIST_COLUMNS]);
    expect(JSON.stringify(body.item)).not.toContain(String(row.token_hash));
    expect(body.item).toMatchObject({ actor_type: "ai", rate_limit_per_min: 300 });
  });

  it("só com nome grava token inerte (sem escopo)", async () => {
    await POST(post({ name: "n8n" }));

    expect(insertMock.mock.calls[0][0]).toMatchObject({ scopes: [], actor_type: "api", rate_limit_per_min: 120 });
  });

  it("escopo desconhecido → 400 com o erro no campo, sem gravar", async () => {
    const response = await POST(post({ name: "x", scopes: ["tickets:apagar"] }));

    expect(response.status).toBe(400);
    expect((await response.json()).errors.scopes).toBeDefined();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
