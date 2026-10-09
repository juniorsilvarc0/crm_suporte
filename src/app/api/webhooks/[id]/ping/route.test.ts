// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, hasEnvMock, clientMock, postMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  hasEnvMock: vi.fn(),
  clientMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasEnvMock,
  createSupabaseAdminClient: clientMock,
}));
vi.mock("@/features/webhooks/server/send", () => ({ postWebhook: postMock }));

import { POST } from "@/app/api/webhooks/[id]/ping/route";
import { createHarness, type Call } from "@/app/api/v1/test-harness";

const SUB_ID = "5b0e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const SECRET = "d".repeat(64);
const NOW = new Date("2026-10-09T12:00:00.000Z");

const h = createHarness(clientMock);
const ping = (id = SUB_ID) => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });
const audited = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);

// O teto é por administrador e mora na memória do processo: cada teste usa um
// administrador só dele.
let admin = 0;
let adminId = "";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.reset([]);
  h.tables.webhook_subscriptions = () => ({
    data: { id: SUB_ID, name: "ERP", url: "https://erp.exemplo.com/hook" },
    error: null,
  });
  h.rpcs.get_webhook_subscription_secret = () => ({ data: SECRET, error: null });
  admin += 1;
  adminId = `admin-ping-${admin}`;
  requireAdminMock.mockResolvedValue({ viewer: { id: adminId, role: "admin" } });
  hasEnvMock.mockReturnValue(true);
  postMock.mockResolvedValue({ error: null, httpStatus: 200, latencyMs: 85 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/webhooks/[id]/ping", () => {
  it("envia um webhook.ping assinado à URL salva e registra o desfecho", async () => {
    const response = await ping();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toEqual({ error: null, httpStatus: 200, latencyMs: 85 });

    const [target, secret, event] = postMock.mock.calls[0] as [URL, string, { name: string; id: string; body: string }];
    expect(target.toString()).toBe("https://erp.exemplo.com/hook");
    expect(secret).toBe(SECRET);
    expect(event.name).toBe("webhook.ping");
    expect(JSON.parse(event.body)).toEqual({
      id: event.id,
      event: "webhook.ping",
      occurred_at: NOW.toISOString(),
      data: { subscription_id: SUB_ID, name: "ERP" },
      ticket: null,
    });
    expect(audited()).toEqual([
      expect.objectContaining({
        provider: "webhooks",
        direction: "outbound",
        action: "webhook.ping",
        status: "ok",
        request_id: event.id,
        http_status: 200,
        latency_ms: 85,
        payload: { by: adminId, subscription_id: SUB_ID },
      }),
    ]);
  });

  it("destino que falhou: 200 com o motivo em result, registrado como erro", async () => {
    postMock.mockResolvedValue({ error: "O destino respondeu HTTP 401.", httpStatus: 401, latencyMs: 30 });
    const body = await (await ping()).json();
    expect(body.result.error).toBe("O destino respondeu HTTP 401.");
    expect(audited()).toEqual([expect.objectContaining({ status: "error", error: "O destino respondeu HTTP 401." })]);
  });

  it("sem segredo ou com URL recusada: nada sai", async () => {
    h.rpcs.get_webhook_subscription_secret = () => ({ data: null, error: null });
    expect((await (await ping()).json()).result.error).toBe("Destino sem segredo de assinatura.");

    h.tables.webhook_subscriptions = () => ({ data: { id: SUB_ID, name: "ERP", url: "http://192.168.0.10/x" }, error: null });
    expect((await (await ping()).json()).result.error).toMatch(/^URL recusada: /);
    expect(postMock).not.toHaveBeenCalled();
  });

  it("destino que não existe: 404", async () => {
    h.tables.webhook_subscriptions = () => ({ data: null, error: null });
    expect((await ping()).status).toBe(404);
    expect(postMock).not.toHaveBeenCalled();
  });

  it("10 testes por minuto passam; o 11º é recusado sem nada sair", async () => {
    for (let i = 0; i < 10; i += 1) expect((await ping()).status).toBe(200);
    const response = await ping();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(postMock).toHaveBeenCalledTimes(10);
  });
});
