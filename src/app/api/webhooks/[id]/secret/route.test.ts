// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, hasEnvMock, clientMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  hasEnvMock: vi.fn(),
  clientMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasEnvMock,
  createSupabaseAdminClient: clientMock,
}));

import { POST } from "@/app/api/webhooks/[id]/secret/route";
import { createHarness, type Call } from "@/app/api/v1/test-harness";

// A troca contra um cofre de mentira que GUARDA o que recebe: a releitura
// depois de gravar devolve o que ficou.

const SUB_ID = "5b0e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const KEY = /^[0-9a-f]{64}$/;

const h = createHarness(clientMock);
let vault: string | null;
let errorSpy: ReturnType<typeof vi.spyOn>;
const rotate = (id = SUB_ID) => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });
const audited = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  vault = "b".repeat(64);
  h.rpcs.set_webhook_subscription_secret = (args) => {
    vault = String(args.p_value);
    return { data: true, error: null };
  };
  h.rpcs.get_webhook_subscription_secret = () => ({ data: vault, error: null });
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  hasEnvMock.mockReturnValue(true);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("POST /api/webhooks/[id]/secret", () => {
  it("gera um segredo novo, confere o que ficou e o devolve uma vez, sem cache", async () => {
    const response = await rotate();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.secret).toMatch(KEY);
    expect(body.secret).toBe(vault);
    expect(audited()).toEqual([
      expect.objectContaining({ action: "secret.rotated", payload: { by: "admin-1", subscription_id: SUB_ID } }),
    ]);
    expect(JSON.stringify(audited())).not.toContain(body.secret);
  });

  it("outra troca ao mesmo tempo: 409, sem devolver um segredo que já não vale", async () => {
    h.rpcs.get_webhook_subscription_secret = () => ({ data: "c".repeat(64), error: null });
    const response = await rotate();
    expect(response.status).toBe(409);
    expect((await response.json()).secret).toBeUndefined();
    expect(audited()).toEqual([]);
  });

  it("erro ao gravar, mas o cofre guardou: vale (o erro veio depois do commit)", async () => {
    h.rpcs.set_webhook_subscription_secret = (args) => {
      vault = String(args.p_value);
      return { data: null, error: { code: "08006", message: "conexão caiu" } };
    };
    const response = await rotate();
    expect(response.status).toBe(200);
    expect((await response.json()).secret).toBe(vault);
  });

  it("erro ao gravar e nada mudou: 500 sem segredo", async () => {
    h.rpcs.set_webhook_subscription_secret = () => ({ data: null, error: { code: "08006", message: "conexão caiu" } });
    const response = await rotate();
    expect(response.status).toBe(500);
    expect((await response.json()).secret).toBeUndefined();
  });

  it("destino que não existe: 404; id inválido: 400", async () => {
    h.rpcs.set_webhook_subscription_secret = () => ({
      data: null,
      error: { code: "P0002", message: "webhook_subscription_not_found" },
    });
    expect((await rotate()).status).toBe(404);
    expect((await rotate("abc")).status).toBe(400);
    expect(audited()).toEqual([]);
  });

  it("o segredo não vai para o log do servidor", async () => {
    h.rpcs.set_webhook_subscription_secret = () => ({ data: null, error: { code: "08006", message: "conexão caiu" } });
    await rotate();
    const setArgs = h.rpcCalls.find(([name]) => name === "set_webhook_subscription_secret")?.[1];
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(String(setArgs?.p_value));
  });
});
