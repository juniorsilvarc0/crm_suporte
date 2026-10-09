// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET } from "@/app/api/webhooks/deliveries/route";
import { createHarness, has, where } from "@/app/api/v1/test-harness";

const SUB_ID = "5b0e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const ROW = {
  id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  payload: { subscription_id: SUB_ID, event: "ticket.created", event_id: "e1", occurred_at: "x", data: {} },
  status: "dead_letter",
  attempts: 8,
  next_attempt_at: "2026-10-09T12:00:00Z",
  last_http_status: 500,
  last_error: "O destino respondeu HTTP 500.",
  created_at: "2026-10-06T12:00:00Z",
  delivered_at: null,
};

const h = createHarness(clientMock);
const list = (query = "") => GET(new Request(`http://x/api/webhooks/deliveries${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  h.tables.event_outbox = () => ({ data: [ROW], error: null });
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  hasEnvMock.mockReturnValue(true);
});

describe("GET /api/webhooks/deliveries", () => {
  it("lê só a fila de webhooks, filtrada pelo destino e pelo status", async () => {
    const response = await list(`?subscription=${SUB_ID}&status=dead_letter`);
    const body = await response.json();

    expect(response.status).toBe(200);
    const chain = h.lastChain("event_outbox");
    expect(where(chain, "kind", "webhook")).toBe(true);
    expect(where(chain, "payload->>subscription_id", SUB_ID)).toBe(true);
    expect(where(chain, "status", "dead_letter")).toBe(true);
    // A lease não é lida: o grant nem a concede.
    expect(JSON.stringify(chain)).not.toContain("lease");
    expect(has(chain, "limit", 50)).toBe(true);
    expect(body.deliveries).toEqual([
      {
        id: ROW.id,
        subscriptionId: SUB_ID,
        event: "ticket.created",
        eventId: "e1",
        status: "dead_letter",
        attempts: 8,
        nextAttemptAt: "2026-10-09T12:00:00Z",
        httpStatus: 500,
        error: "O destino respondeu HTTP 500.",
        createdAt: "2026-10-06T12:00:00Z",
        deliveredAt: null,
      },
    ]);
  });

  it("filtro inválido: 400, sem consultar", async () => {
    expect((await list("?status=qualquer")).status).toBe(400);
    expect((await list("?subscription=abc")).status).toBe(400);
    expect(h.chains.event_outbox).toBeUndefined();
  });
});
