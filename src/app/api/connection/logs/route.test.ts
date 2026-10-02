// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, logsMock } = vi.hoisted(() => ({ requireAdminMock: vi.fn(), logsMock: vi.fn() }));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/features/integrations/queries/get-integration-logs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/integrations/queries/get-integration-logs")>()),
  getIntegrationLogs: logsMock,
}));

import * as route from "@/app/api/connection/logs/route";
import { GET } from "@/app/api/connection/logs/route";

const TOKEN_ID = "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90";
const ITEM = {
  id: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-10-01T11:59:00.123456+00:00",
  provider: "api_v1",
  direction: "inbound",
  action: "GET",
  status: "ok",
  http_status: 200,
  latency_ms: 12,
  route: "/api/v1/tickets",
  request_id: "pedido-1",
  error: null,
  token: { id: TOKEN_ID, name: "IA de triagem", prefix: "crmsuporte_ab" },
  actor: null,
};

const get = (query = "") => GET(new Request(`http://crm.test/api/connection/logs${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  logsMock.mockResolvedValue({ state: "ok", items: [ITEM], nextCursor: "proximo" });
});

describe("GET /api/connection/logs", () => {
  it("só lê: a rota exporta GET e mais nada que grave", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "runtime"]);
  });

  it("recusa quem não é administrador sem ler os registros", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });

    const response = await get();

    expect(response.status).toBe(403);
    expect(logsMock).not.toHaveBeenCalled();
  });

  it("sem filtro na URL: pede a primeira página dos últimos 7 dias", async () => {
    const response = await get();

    expect(logsMock).toHaveBeenCalledTimes(1);
    expect(logsMock).toHaveBeenCalledWith({
      provider: null,
      status: null,
      action: null,
      tokenId: null,
      requestId: null,
      period: "7d",
      cursor: null,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, items: [ITEM], nextCursor: "proximo" });
  });

  it("leva cada filtro da URL à consulta", async () => {
    await get(`?integracao=relay&status=error&acao=webhook.ping&token=${TOKEN_ID}&pedido=pedido-7&periodo=24h&cursor=abc`);

    expect(logsMock).toHaveBeenCalledWith({
      provider: "relay",
      status: "error",
      action: "webhook.ping",
      tokenId: TOKEN_ID,
      requestId: "pedido-7",
      period: "24h",
      cursor: "abc",
    });
  });

  it("cursor que não é desta lista: 400", async () => {
    logsMock.mockResolvedValue({ state: "invalid_cursor" });

    const response = await get("?cursor=lixo");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Cursor inválido." });
  });

  it("a leitura falha: 500 com aviso, e não uma lista vazia", async () => {
    logsMock.mockResolvedValue({ state: "unavailable" });

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: "Não foi possível ler os registros." });
  });

  it("última página: `nextCursor` nulo", async () => {
    logsMock.mockResolvedValue({ state: "ok", items: [], nextCursor: null });

    expect(await (await get()).json()).toEqual({ ok: true, items: [], nextCursor: null });
  });
});
