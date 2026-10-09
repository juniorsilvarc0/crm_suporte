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

import { DELETE, PATCH } from "@/app/api/webhooks/[id]/route";
import { createHarness, has, where, type Call } from "@/app/api/v1/test-harness";

const SUB_ID = "5b0e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const ROW = {
  id: SUB_ID,
  name: "ERP",
  url: "https://novo.exemplo.com/hook",
  events: ["ticket.created"],
  is_active: false,
  secret_id: "vault-1",
  created_at: "2026-10-09T12:00:00Z",
  updated_at: "2026-10-09T12:05:00Z",
};

const h = createHarness(clientMock);
const params = (id = SUB_ID) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown, id?: string) =>
  PATCH(
    new Request("http://x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    params(id)
  );
const del = (id?: string) => DELETE(new Request("http://x", { method: "DELETE" }), params(id));
const audited = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  h.tables.webhook_subscriptions = () => ({ data: ROW, error: null });
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  hasEnvMock.mockReturnValue(true);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("PATCH /api/webhooks/[id]", () => {
  it("grava só o que mudou e registra os NOMES dos campos, não os valores", async () => {
    const response = await patch({ url: "https://novo.exemplo.com/hook", is_active: false });

    expect(response.status).toBe(200);
    expect((await response.json()).subscription).toMatchObject({ isActive: false, hasSecret: true });
    const chain = h.lastChain("webhook_subscriptions");
    expect(has(chain, "update", { is_active: false, url: "https://novo.exemplo.com/hook" })).toBe(true);
    expect(where(chain, "id", SUB_ID)).toBe(true);
    expect(audited()).toEqual([
      expect.objectContaining({
        action: "subscription.updated",
        payload: { by: "admin-1", subscription_id: SUB_ID, fields: ["is_active", "url"] },
      }),
    ]);
    expect(JSON.stringify(audited())).not.toContain("novo.exemplo.com");
  });

  it("a URL nova passa pela guarda de novo", async () => {
    const response = await patch({ url: "http://169.254.169.254/latest" });
    expect(response.status).toBe(422);
    expect(h.chains.webhook_subscriptions).toBeUndefined();
  });

  it("destino que não existe: 404; id que não é uuid: 400", async () => {
    h.tables.webhook_subscriptions = () => ({ data: null, error: null });
    expect((await patch({ name: "X" })).status).toBe(404);
    expect((await patch({ name: "X" }, "abc")).status).toBe(400);
    expect(audited()).toEqual([]);
  });
});

describe("DELETE /api/webhooks/[id]", () => {
  it("exclui e registra quem excluiu", async () => {
    h.tables.webhook_subscriptions = () => ({ data: { id: SUB_ID }, error: null });
    expect((await del()).status).toBe(200);
    expect(has(h.lastChain("webhook_subscriptions"), "delete")).toBe(true);
    expect(audited()).toEqual([
      expect.objectContaining({ action: "subscription.deleted", payload: { by: "admin-1", subscription_id: SUB_ID } }),
    ]);
  });

  it("destino que não existe: 404, sem registro", async () => {
    h.tables.webhook_subscriptions = () => ({ data: null, error: null });
    expect((await del()).status).toBe(404);
    expect(audited()).toEqual([]);
  });
});
