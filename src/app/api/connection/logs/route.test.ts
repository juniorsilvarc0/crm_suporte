// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, logsMock } = vi.hoisted(() => ({ requireAdminMock: vi.fn(), logsMock: vi.fn() }));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/features/integrations/queries/get-integration-logs", () => ({ getIntegrationLogs: logsMock }));

import * as route from "@/app/api/connection/logs/route";
import { GET } from "@/app/api/connection/logs/route";

const TOKEN_ID = "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90";
const NO_FILTERS = { integracao: null, status: null, acao: null, token: null, pedido: null, periodo: "7d" };
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

const NOW = new Date("2026-10-01T12:00:00.000Z");

const get = (query = "") => GET(new Request(`http://crm.test/api/connection/logs${query}`));

// O teto é por administrador e mora na memória do processo: cada teste usa um
// administrador só dele, para um não gastar a cota do outro.
let admin = 0;
const asAdmin = (id: string) => requireAdminMock.mockResolvedValue({ viewer: { id, role: "admin" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  admin += 1;
  asAdmin(`admin-registros-${admin}`);
  logsMock.mockResolvedValue({ state: "ok", items: [ITEM], nextCursor: "proximo" });
});

afterEach(() => {
  vi.useRealTimers();
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

  it("sem nada na URL: pede a primeira página dos últimos 7 dias, e diz os filtros que valeram", async () => {
    const response = await get();

    expect(logsMock).toHaveBeenCalledTimes(1);
    expect(logsMock).toHaveBeenCalledWith(NO_FILTERS, null);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, filters: NO_FILTERS, items: [ITEM], nextCursor: "proximo" });
  });

  it("leva cada filtro da URL à consulta, e o cursor à parte", async () => {
    const filters = {
      integracao: "relay",
      status: "error",
      acao: "webhook.ping",
      token: TOKEN_ID,
      pedido: "pedido-7",
      periodo: "24h",
    };

    const response = await get(
      `?integracao=relay&status=error&acao=webhook.ping&token=${TOKEN_ID}&pedido=pedido-7&periodo=24h&cursor=abc`
    );

    expect(logsMock).toHaveBeenCalledWith(filters, "abc");
    expect((await response.json()).filters).toEqual(filters);
  });

  it("filtro que a lista não conhece é ignorado, e a resposta mostra que foi", async () => {
    const response = await get("?integracao=uazapi&status=talvez&acao=apagar&periodo=1y&token=x&pedido=a%00b&ordem=antigos");

    expect(logsMock).toHaveBeenCalledWith(NO_FILTERS, null);
    expect(response.status).toBe(200);
    expect((await response.json()).filters).toEqual(NO_FILTERS);
  });

  it("parâmetro repetido: vale o primeiro, como na página", async () => {
    await get("?periodo=24h&periodo=90d&integracao=api_v1&integracao=relay&cursor=um&cursor=dois");

    expect(logsMock).toHaveBeenCalledWith({ ...NO_FILTERS, periodo: "24h", integracao: "api_v1" }, "um");
  });

  it.each([
    ["vazio", "?cursor="],
    ["só espaços", "?cursor=%20%20"],
  ])("cursor %s é o mesmo que sem cursor: primeira página", async (_label, query) => {
    await get(query);

    expect(logsMock).toHaveBeenCalledWith(NO_FILTERS, null);
  });

  it("cursor com espaço em volta chega aparado; qualquer outro texto chega inteiro, para a consulta decidir", async () => {
    await get("?cursor=%20abc%20");
    expect(logsMock).toHaveBeenLastCalledWith(NO_FILTERS, "abc");

    const long = "c".repeat(500);
    await get(`?cursor=${long}`);
    expect(logsMock).toHaveBeenLastCalledWith(NO_FILTERS, long);
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

    expect(await (await get()).json()).toEqual({ ok: true, filters: NO_FILTERS, items: [], nextCursor: null });
  });
});

describe("GET /api/connection/logs: teto por administrador", () => {
  const burst = async (times: number) => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i += 1) statuses.push((await get()).status);
    return statuses;
  };

  it("60 leituras por minuto passam; a 61ª é recusada sem ler o banco", async () => {
    expect(await burst(60)).toEqual(Array(60).fill(200));
    vi.setSystemTime(new Date(NOW.getTime() + 20_000));

    const response = await get();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Muitos pedidos seguidos. Tente de novo em 40 s.",
    });
    expect(response.headers.get("Retry-After")).toBe("40");
    expect(logsMock).toHaveBeenCalledTimes(60);
  });

  it("passado o minuto, volta a ler", async () => {
    await burst(61);
    expect(logsMock).toHaveBeenCalledTimes(60);

    vi.setSystemTime(new Date(NOW.getTime() + 59_999));
    expect((await get()).status).toBe(429);

    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    expect((await get()).status).toBe(200);
    expect(logsMock).toHaveBeenCalledTimes(61);
  });

  it("o teto é de cada administrador: o de um não gasta o do outro", async () => {
    await burst(61);
    asAdmin(`outro-admin-registros-${admin}`);

    expect((await get()).status).toBe(200);
  });

  it("quem não é administrador é recusado antes de gastar a cota de alguém", async () => {
    await burst(59);
    requireAdminMock.mockResolvedValueOnce({ error: NextResponse.json({ ok: false }, { status: 403 }) });
    expect((await get()).status).toBe(403);

    // O pedido recusado não contou: a 60ª leitura do administrador ainda passa.
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
  });

  it("pedido com cursor inválido conta como os outros: o teto vale antes da consulta", async () => {
    logsMock.mockResolvedValue({ state: "invalid_cursor" });

    expect(await burst(61)).toEqual([...Array(60).fill(400), 429]);
  });
});
