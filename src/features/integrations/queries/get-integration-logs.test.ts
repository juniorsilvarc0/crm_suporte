import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, envMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  envMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: envMock,
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import {
  INTEGRATION_LOG_SELECT,
  INTEGRATION_LOGS_LIMIT,
  getIntegrationLogs,
  parseIntegrationLogFilters,
} from "@/features/integrations/queries/get-integration-logs";
import type { IntegrationLog, IntegrationLogFilters } from "@/features/integrations/types";

type Call = [method: string, ...args: unknown[]];

// Builder encadeável que grava cada chamada e resolve com `result` quando é
// aguardado. Não tem `ilike` nem `.or()`: se o filtro um dia montar um, o teste
// quebra.
function fakeQuery(result: unknown) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  fromMock.mockReturnValueOnce(builder);
  return calls;
}

const row = (overrides: Partial<IntegrationLog & { payload: unknown }> = {}) => ({
  id: "l1",
  provider: "relay",
  direction: "outbound",
  action: "conversation.message_received",
  status: "ok",
  error: null,
  api_token_id: null,
  request_id: "msg-1",
  route: null,
  http_status: 200,
  latency_ms: 120,
  created_at: "2026-10-02T12:00:00.123456+00:00",
  ...overrides,
});

const noFilters: IntegrationLogFilters = { provider: null, action: null, status: null, requestId: null };

beforeEach(() => {
  vi.clearAllMocks();
  envMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseIntegrationLogFilters", () => {
  it("lê os quatro filtros da URL", () => {
    expect(
      parseIntegrationLogFilters({
        integracao: "relay",
        acao: "signing_secret.rotated",
        status: "error",
        request_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      })
    ).toEqual({
      provider: "relay",
      action: "signing_secret.rotated",
      status: "error",
      requestId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
  });

  it("sem parâmetro, nenhum filtro", () => {
    expect(parseIntegrationLogFilters({})).toEqual(noFilters);
  });

  it("valor fora da forma da coluna vira 'sem filtro', e não erro", () => {
    expect(
      parseIntegrationLogFilters({
        integracao: "Relay",
        acao: "a,b",
        status: "erro",
        request_id: "x".repeat(129),
      })
    ).toEqual(noFilters);
  });

  it("recusa o que mudaria o sentido do filtro no PostgREST", () => {
    for (const value of ["relay)", "relay,status.eq.ok", "relay ", "*", "%", ""]) {
      expect(parseIntegrationLogFilters({ integracao: value }).provider).toBe(value.trim() === "relay" ? "relay" : null);
    }
    expect(parseIntegrationLogFilters({ acao: "GET (x)" }).action).toBeNull();
    expect(parseIntegrationLogFilters({ request_id: "a b" }).requestId).toBeNull();
  });

  it("tira espaço em volta e usa a primeira ocorrência do parâmetro", () => {
    expect(parseIntegrationLogFilters({ integracao: ["  api_v1 ", "relay"], status: ["ok", "error"] })).toEqual({
      ...noFilters,
      provider: "api_v1",
      status: "ok",
    });
  });

  it("aceita o maior request_id que a coluna guarda", () => {
    expect(parseIntegrationLogFilters({ request_id: "a".repeat(128) }).requestId).toBe("a".repeat(128));
  });
});

describe("getIntegrationLogs", () => {
  it("sem filtro, lê os mais recentes primeiro, com o teto + 1", async () => {
    const calls = fakeQuery({ data: [row()], error: null });

    const result = await getIntegrationLogs();

    expect(fromMock).toHaveBeenCalledWith("integration_logs");
    expect(calls).toEqual([
      ["select", INTEGRATION_LOG_SELECT],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", INTEGRATION_LOGS_LIMIT + 1],
    ]);
    expect(result).toEqual({ logs: [row()], truncated: false, failed: false });
  });

  it("aplica cada filtro por igualdade", async () => {
    const calls = fakeQuery({ data: [], error: null });

    await getIntegrationLogs({ provider: "relay", action: "webhook.ping", status: "error", requestId: "req-9" });

    expect(calls.filter(([method]) => method === "eq")).toEqual([
      ["eq", "provider", "relay"],
      ["eq", "action", "webhook.ping"],
      ["eq", "status", "error"],
      ["eq", "request_id", "req-9"],
    ]);
  });

  it("não lê nem devolve o payload", async () => {
    fakeQuery({ data: [row({ payload: { by: "u1" } })], error: null });

    const result = await getIntegrationLogs();

    expect(INTEGRATION_LOG_SELECT).not.toContain("payload");
    expect(result.logs[0]).not.toHaveProperty("payload");
  });

  it("seleciona exatamente as colunas do tipo IntegrationLog", () => {
    const columns = INTEGRATION_LOG_SELECT.split(",").map((column) => column.trim()).sort();
    expect(columns).toEqual(Object.keys(row()).sort());
  });

  it("acima do teto, corta e marca truncated", async () => {
    const rows = Array.from({ length: INTEGRATION_LOGS_LIMIT + 1 }, (_, index) => row({ id: `l${index}` }));
    fakeQuery({ data: rows, error: null });

    const result = await getIntegrationLogs();

    expect(result.logs).toHaveLength(INTEGRATION_LOGS_LIMIT);
    expect(result.logs.at(-1)?.id).toBe(`l${INTEGRATION_LOGS_LIMIT - 1}`);
    expect(result.truncated).toBe(true);
  });

  it("exatamente no teto, não marca truncated", async () => {
    const rows = Array.from({ length: INTEGRATION_LOGS_LIMIT }, (_, index) => row({ id: `l${index}` }));
    fakeQuery({ data: rows, error: null });

    const result = await getIntegrationLogs();

    expect(result.logs).toHaveLength(INTEGRATION_LOGS_LIMIT);
    expect(result.truncated).toBe(false);
  });

  it("erro do banco vira lista vazia marcada como falha", async () => {
    fakeQuery({ data: null, error: { message: "boom" } });

    await expect(getIntegrationLogs()).resolves.toEqual({ logs: [], truncated: false, failed: true });
    expect(console.error).toHaveBeenCalled();
  });

  it("exceção também vira falha, sem derrubar a página", async () => {
    fromMock.mockImplementationOnce(() => {
      throw new Error("rede");
    });

    await expect(getIntegrationLogs()).resolves.toEqual({ logs: [], truncated: false, failed: true });
  });

  it("sem as variáveis do Supabase, falha sem consultar", async () => {
    envMock.mockReturnValue(false);

    await expect(getIntegrationLogs()).resolves.toMatchObject({ failed: true });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
