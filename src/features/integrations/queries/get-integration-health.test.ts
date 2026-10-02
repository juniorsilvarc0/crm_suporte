import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock, integrationMock, statusMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
  integrationMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({ getUazapiIntegration: integrationMock }));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({ getUazapiStatus: statusMock }));

import {
  RELAY_HEALTH_WINDOW_HOURS,
  getIntegrationHealth,
} from "@/features/integrations/queries/get-integration-health";
import { RELAY_EVENT } from "@/features/integrations/server/relay-message";

type Call = [method: string, ...args: unknown[]];

const NOW = new Date("2026-10-02T12:00:00.000Z");

// Cada `from(tabela)` devolve um builder que grava as chamadas e resolve com o
// resultado da vez daquela tabela. As duas contagens do relay saem em paralelo:
// a que tem `eq("status", "error")` é a de erros.
function setupTables(results: {
  messages?: unknown;
  relayAll?: unknown;
  relayErrors?: unknown;
}) {
  const calls: Record<string, Call[][]> = { chat_messages: [], integration_logs: [] };
  fromMock.mockImplementation((table: string) => {
    const own: Call[] = [];
    calls[table]?.push(own);
    const resolveWith = () => {
      if (table === "chat_messages") return results.messages;
      const isErrors = own.some(([method, column]) => method === "eq" && column === "status");
      return isErrors ? results.relayErrors : results.relayAll;
    };
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(resolveWith()).then(resolve, reject),
      maybeSingle: () => {
        own.push(["maybeSingle"]);
        return Promise.resolve(resolveWith());
      },
    };
    for (const method of ["select", "eq", "gte", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        own.push([method, ...args]);
        return builder;
      };
    }
    return builder;
  });
  return calls;
}

const integration = { id: "i1", apiUrl: "https://uaz.example.com", token: "tok", phone_number: null };

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  integrationMock.mockResolvedValue(integration);
  statusMock.mockResolvedValue({ connected: true, state: "open", owner: "5527999990000" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getIntegrationHealth", () => {
  it("compõe o estado do WhatsApp, o último inbound e a taxa de erro do relay", async () => {
    setupTables({
      messages: { data: { created_at: "2026-10-02T11:58:00+00:00" }, error: null },
      relayAll: { count: 40, error: null },
      relayErrors: { count: 10, error: null },
    });

    await expect(getIntegrationHealth(NOW)).resolves.toEqual({
      checkedAt: NOW.toISOString(),
      whatsapp: { state: "open", connected: true },
      lastInbound: { state: "ok", at: "2026-10-02T11:58:00+00:00" },
      relay: { state: "ok", windowHours: RELAY_HEALTH_WINDOW_HOURS, total: 40, errors: 10, errorRate: 0.25 },
    });
    expect(statusMock).toHaveBeenCalledWith(integration.apiUrl, integration.token);
  });

  it("o último inbound é a mensagem mais recente que chegou de um contato", async () => {
    const calls = setupTables({
      messages: { data: null, error: null },
      relayAll: { count: 0, error: null },
      relayErrors: { count: 0, error: null },
    });

    const health = await getIntegrationHealth(NOW);

    expect(health.lastInbound).toEqual({ state: "ok", at: null });
    expect(calls.chat_messages).toEqual([
      [
        ["select", "created_at"],
        ["eq", "direction", "inbound"],
        ["order", "created_at", { ascending: false }],
        ["limit", 1],
        ["maybeSingle"],
      ],
    ]);
  });

  it("o relay conta só o repasse de mensagem, na janela, sem ler as linhas", async () => {
    const calls = setupTables({
      messages: { data: null, error: null },
      relayAll: { count: 3, error: null },
      relayErrors: { count: 1, error: null },
    });

    await getIntegrationHealth(NOW);

    const since = new Date(NOW.getTime() - RELAY_HEALTH_WINDOW_HOURS * 3_600_000).toISOString();
    const common: Call[] = [
      ["select", "id", { count: "exact", head: true }],
      ["eq", "provider", "relay"],
      ["eq", "action", RELAY_EVENT],
      ["gte", "created_at", since],
    ];
    expect(RELAY_EVENT).toBe("conversation.message_received");
    expect(calls.integration_logs).toEqual([common, [...common, ["eq", "status", "error"]]]);
  });

  it("sem repasse na janela, a taxa é nula, e não zero", async () => {
    setupTables({
      messages: { data: null, error: null },
      relayAll: { count: 0, error: null },
      relayErrors: { count: 0, error: null },
    });

    const health = await getIntegrationHealth(NOW);

    expect(health.relay).toMatchObject({ total: 0, errors: 0, errorRate: null });
  });

  it("a taxa nunca passa de 100% quando as contagens divergem", async () => {
    setupTables({
      messages: { data: null, error: null },
      relayAll: { count: 2, error: null },
      relayErrors: { count: 3, error: null },
    });

    const health = await getIntegrationHealth(NOW);

    expect(health.relay).toMatchObject({ total: 2, errors: 2, errorRate: 1 });
  });

  it("sem integração configurada, não chama a uazapi", async () => {
    integrationMock.mockResolvedValue(null);
    setupTables({
      messages: { data: null, error: null },
      relayAll: { count: 0, error: null },
      relayErrors: { count: 0, error: null },
    });

    const health = await getIntegrationHealth(NOW);

    expect(health.whatsapp).toEqual({ state: "not_configured" });
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("a uazapi sem resposta é 'unreachable', sem o texto do provedor", async () => {
    statusMock.mockRejectedValue(new Error("uazapi status 500: corpo do provedor"));
    setupTables({
      messages: { data: null, error: null },
      relayAll: { count: 0, error: null },
      relayErrors: { count: 0, error: null },
    });

    const health = await getIntegrationHealth(NOW);

    expect(health.whatsapp).toEqual({ state: "unreachable" });
    expect(JSON.stringify(health)).not.toContain("corpo do provedor");
  });

  it("instância desconectada aparece como tal", async () => {
    statusMock.mockResolvedValue({ connected: false, state: "close", owner: null });
    setupTables({
      messages: { data: null, error: null },
      relayAll: { count: 0, error: null },
      relayErrors: { count: 0, error: null },
    });

    await expect(getIntegrationHealth(NOW)).resolves.toMatchObject({
      whatsapp: { state: "close", connected: false },
    });
  });

  it("cada parte que falha vira 'unreadable' sem derrubar as outras", async () => {
    integrationMock.mockRejectedValue(new Error("vault"));
    setupTables({
      messages: { data: { created_at: "2026-10-02T11:00:00+00:00" }, error: null },
      relayAll: { count: 5, error: null },
      relayErrors: { count: null, error: { message: "boom" } },
    });

    const health = await getIntegrationHealth(NOW);

    expect(health.whatsapp).toEqual({ state: "unreadable" });
    expect(health.lastInbound).toEqual({ state: "ok", at: "2026-10-02T11:00:00+00:00" });
    expect(health.relay).toEqual({ state: "unreadable" });
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("falha do último inbound não derruba o relay", async () => {
    setupTables({
      messages: { data: null, error: { message: "boom" } },
      relayAll: { count: 1, error: null },
      relayErrors: { count: 0, error: null },
    });

    const health = await getIntegrationHealth(NOW);

    expect(health.lastInbound).toEqual({ state: "unreadable" });
    expect(health.relay).toMatchObject({ state: "ok", total: 1, errors: 0, errorRate: 0 });
  });

  it("sem as variáveis do Supabase, tudo 'unreadable' e nada consultado", async () => {
    envMock.mockReturnValue(false);

    await expect(getIntegrationHealth(NOW)).resolves.toEqual({
      checkedAt: NOW.toISOString(),
      whatsapp: { state: "unreadable" },
      lastInbound: { state: "unreadable" },
      relay: { state: "unreadable" },
    });
    expect(fromMock).not.toHaveBeenCalled();
    expect(integrationMock).not.toHaveBeenCalled();
  });
});
