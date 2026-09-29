import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, adminClientMock, updateMock, filters } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  adminClientMock: vi.fn(),
  updateMock: vi.fn(),
  filters: [] as unknown[][],
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: adminMock }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { PATCH } from "@/app/api/api-tokens/[id]/route";

const TOKEN_ID = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ id: TOKEN_ID }) };

function patch(body: unknown) {
  return new Request(`http://x/api/api-tokens/${TOKEN_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let updatedRow: Record<string, unknown> | null;

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  adminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  updatedRow = {
    id: TOKEN_ID,
    name: "IA",
    token_prefix: "crmsuporte_a",
    scopes: ["context:read"],
    actor_type: "ai",
    rate_limit_per_min: 300,
    expires_at: null,
    created_at: "2026-09-29T00:00:00Z",
    last_used_at: null,
    revoked_at: null,
  };
  updateMock.mockImplementation(() => {
    const chain = {
      eq: (...args: unknown[]) => {
        filters.push(["eq", ...args]);
        return chain;
      },
      is: (...args: unknown[]) => {
        filters.push(["is", ...args]);
        return chain;
      },
      select: () => chain,
      maybeSingle: async () => ({ data: updatedRow, error: null }),
    };
    return chain;
  });
  adminClientMock.mockReturnValue({ from: () => ({ update: updateMock }) });
});

describe("PATCH /api/api-tokens/[id]", () => {
  it("member → 403 sem tocar o banco", async () => {
    adminMock.mockResolvedValue({ error: Response.json({ ok: false }, { status: 403 }) });

    const response = await PATCH(patch({ scopes: [] }), params);

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("id fora de UUID → 400", async () => {
    const response = await PATCH(patch({ scopes: [] }), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("corpo sem nada a alterar → 400 dizendo o motivo", async () => {
    const response = await PATCH(patch({}), params);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Nada para alterar.");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("hash e prefixo não se alteram: só as chaves editáveis chegam ao banco", async () => {
    await PATCH(patch({ name: "novo", token_hash: "b".repeat(64), token_prefix: "x", revoked_at: null }), params);

    expect(updateMock).toHaveBeenCalledWith({ name: "novo" });
  });

  it("altera só o que veio, e só em token não revogado", async () => {
    const response = await PATCH(patch({ scopes: ["context:read"], actor_type: "ai" }), params);

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ scopes: ["context:read"], actor_type: "ai" });
    expect(filters).toEqual([
      ["eq", "id", TOKEN_ID],
      ["is", "revoked_at", null],
    ]);
    expect((await response.json()).item).toMatchObject({ scopes: ["context:read"], actor_type: "ai" });
  });

  it("token revogado ou inexistente → 404", async () => {
    updatedRow = null;

    const response = await PATCH(patch({ name: "novo" }), params);

    expect(response.status).toBe(404);
  });

  it("escopo desconhecido → 400 sem gravar", async () => {
    const response = await PATCH(patch({ scopes: ["faturas:*"] }), params);

    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
