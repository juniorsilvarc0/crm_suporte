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

import { POST } from "@/app/api/webhooks/deliveries/[id]/requeue/route";
import { createHarness, type Call } from "@/app/api/v1/test-harness";

const DELIVERY_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const SUB_ID = "5b0e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";

const h = createHarness(clientMock);
const requeue = (id = DELIVERY_ID) => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });
const audited = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  h.rpcs.outbox_requeue = () => ({ data: true, error: null });
  h.tables.event_outbox = () => ({ data: { payload: { subscription_id: SUB_ID } }, error: null });
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  hasEnvMock.mockReturnValue(true);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("POST /api/webhooks/deliveries/[id]/requeue", () => {
  it("devolve a entrega morta à fila e registra quem reenviou", async () => {
    expect((await requeue()).status).toBe(200);
    expect(h.rpcCalls).toEqual([["outbox_requeue", { p_id: DELIVERY_ID }]]);
    expect(audited()).toEqual([
      expect.objectContaining({
        action: "delivery.requeued",
        payload: { by: "admin-1", subscription_id: SUB_ID, delivery_id: DELIVERY_ID },
      }),
    ]);
  });

  it("entrega que não esgotou as tentativas (ou não existe): 409, sem registro", async () => {
    h.rpcs.outbox_requeue = () => ({ data: false, error: null });
    expect((await requeue()).status).toBe(409);
    expect(audited()).toEqual([]);
  });

  it("id inválido: 400; erro do banco: 500", async () => {
    expect((await requeue("abc")).status).toBe(400);
    h.rpcs.outbox_requeue = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await requeue()).status).toBe(500);
  });
});
