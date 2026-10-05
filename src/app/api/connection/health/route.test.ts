// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, healthMock } = vi.hoisted(() => ({ requireAdminMock: vi.fn(), healthMock: vi.fn() }));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/features/integrations/queries/get-integration-health", () => ({ getIntegrationHealth: healthMock }));

import * as route from "@/app/api/connection/health/route";
import { GET } from "@/app/api/connection/health/route";

const HEALTH = {
  generatedAt: "2026-10-01T12:00:00.000Z",
  windowHours: 24,
  whatsapp: { state: "unavailable" },
  lastInbound: { state: "ok", at: null, exact: true },
  relay: { config: "none", deliveries: { state: "unavailable" } },
  api: { calls: { state: "ok", total: 0, clientErrors: 0, serverErrors: 0 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  healthMock.mockResolvedValue(HEALTH);
});

describe("GET /api/connection/health", () => {
  it("só lê: a rota exporta GET, e não recebe pedido de onde tirar parâmetro", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "runtime"]);
    expect(GET).toHaveLength(0);
  });

  it("recusa quem não é administrador sem consultar nada", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(healthMock).not.toHaveBeenCalled();
  });

  it("responde 200 mesmo com parte indisponível: cada parte diz o próprio estado", async () => {
    const response = await GET();

    expect(healthMock).toHaveBeenCalledTimes(1);
    expect(healthMock).toHaveBeenCalledWith();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, health: HEALTH });
  });
});
