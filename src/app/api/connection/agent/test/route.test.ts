// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, pingMock, hasEnvMock, clientMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  pingMock: vi.fn(),
  hasEnvMock: vi.fn(),
  clientMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasEnvMock,
  createSupabaseAdminClient: clientMock,
}));
vi.mock("@/features/integrations/server/relay-ping", () => ({ pingAgent: pingMock }));

import * as route from "@/app/api/connection/agent/test/route";
import { POST } from "@/app/api/connection/agent/test/route";

const ADMIN_CLIENT = { marker: "admin-client" };
const DELIVERED = { sent: true, delivered: true, error: null, httpStatus: 200, latencyMs: 120, signed: true };
const NOW = new Date("2026-10-01T12:00:00.000Z");

// O teto é por administrador e mora na memória do processo: cada teste usa um
// administrador só dele, para um não gastar a cota do outro.
let admin = 0;
const asAdmin = (id: string) => requireAdminMock.mockResolvedValue({ viewer: { id, role: "admin" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  admin += 1;
  asAdmin(`admin-teste-${admin}`);
  hasEnvMock.mockReturnValue(true);
  clientMock.mockReturnValue(ADMIN_CLIENT);
  pingMock.mockResolvedValue(DELIVERED);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/connection/agent/test", () => {
  it("só testa a URL SALVA: a rota não recebe pedido nenhum de onde ler outro endereço", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    // Sem parâmetro, o handler não tem corpo nem query de onde tirar uma URL.
    expect(POST).toHaveLength(0);
  });

  it("recusa não-admin sem disparar o teste", async () => {
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(pingMock).not.toHaveBeenCalled();
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("sem o Supabase configurado: 500, sem disparar o teste", async () => {
    hasEnvMock.mockReturnValue(false);

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: "Supabase não configurado." });
    expect(pingMock).not.toHaveBeenCalled();
  });

  it.each([
    ["o agente confirmou", DELIVERED],
    [
      "o agente recusou",
      { sent: true, delivered: false, error: "O agente respondeu HTTP 401.", httpStatus: 401, latencyMs: 80, signed: false },
    ],
    ["nada saiu", { sent: false, error: "Nenhuma URL de agente configurada." }],
  ])("quando %s: 200 com o desfecho do teste, sem alterá-lo", async (_label, result) => {
    pingMock.mockResolvedValue(result);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result });
    // Um teste por pedido, com o client de serviço (é ele que lê a URL e grava o registro).
    expect(pingMock.mock.calls).toEqual([[ADMIN_CLIENT]]);
  });
});

describe("POST /api/connection/agent/test: teto por administrador", () => {
  const burst = async (times: number) => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i += 1) statuses.push((await POST()).status);
    return statuses;
  };

  it("10 testes por minuto passam; o 11º é recusado sem nada sair", async () => {
    expect(await burst(10)).toEqual(Array(10).fill(200));
    vi.setSystemTime(new Date(NOW.getTime() + 20_000));

    const response = await POST();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Muitos testes seguidos. Tente de novo em 40 s.",
    });
    expect(response.headers.get("Retry-After")).toBe("40");
    expect(pingMock).toHaveBeenCalledTimes(10);
  });

  it("passado o minuto, volta a testar", async () => {
    await burst(11);
    expect(pingMock).toHaveBeenCalledTimes(10);

    vi.setSystemTime(new Date(NOW.getTime() + 59_999));
    expect((await POST()).status).toBe(429);

    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    expect((await POST()).status).toBe(200);
    expect(pingMock).toHaveBeenCalledTimes(11);
  });

  it("o teto é de cada administrador: o de um não gasta o do outro", async () => {
    await burst(11);
    asAdmin(`outro-admin-${admin}`);

    expect((await POST()).status).toBe(200);
  });

  it("pedido recusado antes do teste não gasta a cota (não-admin e Supabase ausente)", async () => {
    const me = `admin-teste-${admin}`;
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 403 }) });
    await burst(15);
    asAdmin(me);
    hasEnvMock.mockReturnValue(false);
    await burst(15);
    hasEnvMock.mockReturnValue(true);

    expect(await burst(10)).toEqual(Array(10).fill(200));
  });
});
