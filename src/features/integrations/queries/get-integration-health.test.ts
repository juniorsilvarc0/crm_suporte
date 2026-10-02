// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock, hasEnvMock, relayConfigMock, integrationMock, statusMock } = vi.hoisted(() => ({
  clientMock: vi.fn(),
  hasEnvMock: vi.fn(),
  relayConfigMock: vi.fn(),
  integrationMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: clientMock,
  hasSupabaseAdminEnv: hasEnvMock,
}));
vi.mock("@/features/settings/lib/get-relay-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/settings/lib/get-relay-url")>()),
  getRelayConfig: relayConfigMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({ getUazapiIntegration: integrationMock }));
vi.mock("@/features/chat/lib/connection/uazapi", () => ({ getUazapiStatus: statusMock }));

import { createHarness, has, where, type Call, type Result } from "@/app/api/v1/test-harness";
import {
  getIntegrationHealth,
  HEALTH_WINDOW_HOURS,
} from "@/features/integrations/queries/get-integration-health";

const h = createHarness(clientMock);

const NOW = new Date("2026-10-01T12:00:00.000Z");
const SINCE = "2026-09-30T12:00:00.000Z";
const RELAY_EVENT = "conversation.message_received";
const INTEGRATION = { id: "integracao-1", apiUrl: "https://demo.invalid", token: "token-de-mentira", phone_number: "5511888880000" };

const at = (hhmm: string) => `2026-10-01T${hhmm}:00.000000+00:00`;
const isCount = (calls: Call[]) => calls.some(([method, , options]) => method === "select" && (options as { head?: boolean } | undefined)?.head === true);
const eqValue = (calls: Call[], column: string) => calls.find(([method, name]) => method === "eq" && name === column)?.[2];

type Counts = { relayTotal: number; relayErrors: number; apiTotal: number; api4xx: number; api5xx: number };
const COUNTS: Counts = { relayTotal: 40, relayErrors: 3, apiTotal: 500, api4xx: 12, api5xx: 2 };

/** Responde às sete leituras de `integration_logs` olhando os filtros de cada uma. */
function logs(counts: Counts = COUNTS, last: { ok: string | null; error: string | null } = { ok: at("11:58"), error: at("09:10") }) {
  return (calls: Call[]): Result => {
    if (!isCount(calls)) {
      const value = eqValue(calls, "status") === "ok" ? last.ok : last.error;
      return { data: value ? [{ created_at: value }] : [], error: null };
    }
    const provider = eqValue(calls, "provider");
    let count: number;
    if (provider === "relay") {
      count = where(calls, "status", "error") ? counts.relayErrors : counts.relayTotal;
    } else if (has(calls, "lt", "http_status", 500)) {
      count = counts.api4xx;
    } else if (has(calls, "gte", "http_status", 500)) {
      count = counts.api5xx;
    } else {
      count = counts.apiTotal;
    }
    return { data: null, error: null, count } as Result;
  };
}

/** `n` conversas, da mais recente para a mais antiga, a partir do minuto dado. */
function conversations(n: number, firstMinute: number, prefix = "c") {
  return Array.from({ length: n }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    last_message_at: new Date(Date.UTC(2026, 9, 1, 11, 0) - (firstMinute + index) * 60_000).toISOString(),
  }));
}

const countChains = () => (h.chains.integration_logs ?? []).filter(isCount);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  hasEnvMock.mockReturnValue(true);
  relayConfigMock.mockResolvedValue({ configuredUrl: "https://agente.exemplo.com/webhook", state: "active", reason: null });
  integrationMock.mockResolvedValue(INTEGRATION);
  statusMock.mockResolvedValue({ connected: true, state: "open", owner: "5511999990000" });
  h.tables.integration_logs = logs();
  h.tables.chat_conversations = () => ({ data: conversations(2, 0), error: null });
  h.tables.chat_messages = () => ({ data: [{ created_at: at("10:59") }], error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getIntegrationHealth", () => {
  it("tudo respondendo: o estado do WhatsApp, a última mensagem recebida e as contagens das últimas 24 h", async () => {
    expect(await getIntegrationHealth(NOW)).toEqual({
      generatedAt: "2026-10-01T12:00:00.000Z",
      windowHours: 24,
      whatsapp: { state: "open", instance: "5511999990000" },
      lastInbound: { state: "ok", at: at("10:59"), exact: true },
      relay: {
        config: "active",
        deliveries: { state: "ok", total: 40, errors: 3, lastOkAt: at("11:58"), lastErrorAt: at("09:10") },
      },
      api: { calls: { state: "ok", total: 500, clientErrors: 12, serverErrors: 2 } },
    });
    expect(HEALTH_WINDOW_HOURS).toBe(24);
  });

  describe("repasse ao agente", () => {
    it("conta só os repasses de mensagem: o teste de conexão e a trilha da chave usam o mesmo provider", async () => {
      await getIntegrationHealth(NOW);

      const relay = (h.chains.integration_logs ?? []).filter((calls) => eqValue(calls, "provider") === "relay");
      // Total, erros, último que deu certo e último que falhou.
      expect(relay).toHaveLength(4);
      for (const calls of relay) expect(where(calls, "action", RELAY_EVENT)).toBe(true);
    });

    it("as contagens valem para as últimas 24 h; o último repasse não tem janela", async () => {
      await getIntegrationHealth(NOW);

      for (const calls of countChains()) expect(has(calls, "gte", "created_at", SINCE)).toBe(true);
      const last = (h.chains.integration_logs ?? []).filter((calls) => !isCount(calls));
      expect(last).toHaveLength(2);
      for (const calls of last) {
        expect(calls.some(([method, column]) => method === "gte" && column === "created_at")).toBe(false);
        expect(has(calls, "order", "created_at", { ascending: false })).toBe(true);
        expect(has(calls, "limit", 1)).toBe(true);
      }
      expect(last.map((calls) => eqValue(calls, "status")).sort()).toEqual(["error", "ok"]);
    });

    it("erros contam só o status `error`, e o total não filtra status", async () => {
      await getIntegrationHealth(NOW);

      const relayCounts = countChains().filter((calls) => eqValue(calls, "provider") === "relay");
      expect(relayCounts.map((calls) => eqValue(calls, "status")).sort()).toEqual(["error", undefined]);
    });

    it("nenhum repasse ainda: zeros de verdade, e sem data", async () => {
      h.tables.integration_logs = logs({ ...COUNTS, relayTotal: 0, relayErrors: 0 }, { ok: null, error: null });

      const health = await getIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "ok", total: 0, errors: 0, lastOkAt: null, lastErrorAt: null });
    });

    it("leva o estado da configuração do agente, inclusive quando ela não pôde ser lida", async () => {
      for (const state of ["none", "refused", "unreadable"] as const) {
        relayConfigMock.mockResolvedValue({ configuredUrl: null, state, reason: null });

        expect((await getIntegrationHealth(NOW)).relay.config).toBe(state);
      }
    });

    it.each([
      ["a contagem do total", (calls: Call[]) => isCount(calls) && eqValue(calls, "provider") === "relay" && !where(calls, "status", "error")],
      ["a contagem dos erros", (calls: Call[]) => isCount(calls) && where(calls, "status", "error")],
      ["a leitura do último que deu certo", (calls: Call[]) => !isCount(calls) && where(calls, "status", "ok")],
      ["a leitura do último que falhou", (calls: Call[]) => !isCount(calls) && where(calls, "status", "error")],
    ])("%s falha: o repasse fica `unavailable` (e não zero), e a API segue contada", async (_label, fails) => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        fails(calls) ? { data: null, error: { message: "statement timeout", code: "57014" } } : answer(calls);

      const health = await getIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "unavailable" });
      expect(health.api.calls).toEqual({ state: "ok", total: 500, clientErrors: 12, serverErrors: 2 });
    });

    it("contagem que volta sem número é tratada como falha", async () => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        isCount(calls) && eqValue(calls, "provider") === "relay" ? ({ data: null, error: null, count: null } as Result) : answer(calls);

      expect((await getIntegrationHealth(NOW)).relay.deliveries).toEqual({ state: "unavailable" });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: contagem", "sem contagem");
    });

    it("conta de verdade (`exact`), sem trazer linha nenhuma", async () => {
      await getIntegrationHealth(NOW);

      expect(countChains()).toHaveLength(5);
      for (const calls of countChains()) expect(has(calls, "select", "id", { count: "exact", head: true })).toBe(true);
    });
  });

  describe("API v1", () => {
    it("separa o erro de quem chama (4xx) do erro do CRM (5xx)", async () => {
      await getIntegrationHealth(NOW);

      const api = countChains().filter((calls) => eqValue(calls, "provider") === "api_v1");
      expect(api).toHaveLength(3);
      expect(api.filter((calls) => has(calls, "gte", "http_status", 400) && has(calls, "lt", "http_status", 500))).toHaveLength(1);
      expect(api.filter((calls) => has(calls, "gte", "http_status", 500))).toHaveLength(1);
      // O total não filtra pelo status HTTP nem pelo desfecho: conta toda chamada.
      const total = api.filter((calls) => !calls.some(([, column]) => column === "http_status"));
      expect(total).toHaveLength(1);
      expect(total[0].filter(([method]) => method === "eq")).toEqual([["eq", "provider", "api_v1"]]);
    });

    it("uma das contagens falha: a API fica `unavailable`, e o repasse segue contado", async () => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        isCount(calls) && has(calls, "gte", "http_status", 500)
          ? { data: null, error: { message: "statement timeout" } }
          : answer(calls);

      const health = await getIntegrationHealth(NOW);

      expect(health.api.calls).toEqual({ state: "unavailable" });
      expect(health.relay.deliveries).toMatchObject({ state: "ok", total: 40 });
    });
  });

  describe("WhatsApp", () => {
    it("consulta o provedor com a URL e o token da integração, e só lê", async () => {
      await getIntegrationHealth(NOW);

      expect(statusMock).toHaveBeenCalledTimes(1);
      expect(statusMock).toHaveBeenCalledWith("https://demo.invalid", "token-de-mentira");
      // Nada é gravado: o telefone do dono é assunto de /api/connection/state.
      expect(h.chains.chat_integrations).toBeUndefined();
    });

    it.each(["connecting", "close", "unknown"] as const)("repassa o estado `%s`", async (state) => {
      statusMock.mockResolvedValue({ connected: false, state, owner: null });

      expect((await getIntegrationHealth(NOW)).whatsapp).toEqual({ state, instance: "5511888880000" });
    });

    it("sem o dono na resposta do provedor, mostra o telefone guardado; sem nenhum, nulo", async () => {
      statusMock.mockResolvedValue({ connected: true, state: "open", owner: null });
      expect((await getIntegrationHealth(NOW)).whatsapp).toEqual({ state: "open", instance: "5511888880000" });

      integrationMock.mockResolvedValue({ ...INTEGRATION, phone_number: null });
      expect((await getIntegrationHealth(NOW)).whatsapp).toEqual({ state: "open", instance: null });
    });

    it("sem integração: `not_configured`, sem chamar o provedor", async () => {
      integrationMock.mockResolvedValue(null);

      expect((await getIntegrationHealth(NOW)).whatsapp).toEqual({ state: "not_configured" });
      expect(statusMock).not.toHaveBeenCalled();
    });

    it("o provedor não responde: `unavailable`, e o motivo vai só para o log", async () => {
      statusMock.mockRejectedValue(new Error("uazapi status 500: corpo da resposta"));

      const health = await getIntegrationHealth(NOW);

      expect(health.whatsapp).toEqual({ state: "unavailable" });
      expect(JSON.stringify(health)).not.toContain("corpo da resposta");
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: whatsapp", "uazapi status 500: corpo da resposta");
      // As outras partes não dependem do provedor.
      expect(health.api.calls).toMatchObject({ state: "ok" });
      expect(health.lastInbound).toMatchObject({ state: "ok" });
    });

    it("a leitura da integração falha: `unavailable`, sem chamar o provedor", async () => {
      integrationMock.mockRejectedValue(new Error("vault indisponível"));

      expect((await getIntegrationHealth(NOW)).whatsapp).toEqual({ state: "unavailable" });
      expect(statusMock).not.toHaveBeenCalled();
    });

    it("o token da integração não aparece na resposta", async () => {
      expect(JSON.stringify(await getIntegrationHealth(NOW))).not.toContain("token-de-mentira");
    });
  });

  describe("última mensagem recebida", () => {
    it("procura nas conversas mais recentes, só mensagem RECEBIDA, a mais nova", async () => {
      await getIntegrationHealth(NOW);

      const convs = h.lastChain("chat_conversations");
      expect(has(convs, "select", "id, last_message_at")).toBe(true);
      expect(has(convs, "not", "last_message_at", "is", null)).toBe(true);
      expect(has(convs, "order", "last_message_at", { ascending: false })).toBe(true);
      expect(has(convs, "range", 0, 49)).toBe(true);
      const messages = h.lastChain("chat_messages");
      expect(where(messages, "direction", "inbound")).toBe(true);
      expect(has(messages, "in", "conversation_id", ["c1", "c2"])).toBe(true);
      expect(has(messages, "order", "created_at", { ascending: false })).toBe(true);
      expect(has(messages, "limit", 1)).toBe(true);
    });

    it("nenhuma conversa: nunca chegou mensagem, e isso é exato", async () => {
      h.tables.chat_conversations = () => ({ data: [], error: null });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: true });
      expect(h.chains.chat_messages).toBeUndefined();
    });

    it("poucas conversas e nenhuma mensagem recebida: nulo exato, num passo só", async () => {
      h.tables.chat_messages = () => ({ data: [], error: null });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: true });
      expect(h.chains.chat_conversations).toHaveLength(1);
    });

    it("passo cheio em que a mensagem achada é mais nova que a conversa mais antiga do passo: exato, sem descer", async () => {
      // 50 conversas com atividade entre 11:00 e 10:11; a última recebida é das 10:30.
      h.tables.chat_conversations = () => ({ data: conversations(50, 0), error: null });
      h.tables.chat_messages = () => ({ data: [{ created_at: at("10:30") }], error: null });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("10:30"), exact: true });
      expect(h.chains.chat_conversations).toHaveLength(1);
    });

    it("mensagem achada tão nova quanto a conversa mais antiga do passo (empate): já é exato", async () => {
      h.tables.chat_conversations = () => ({ data: conversations(50, 0), error: null });
      // A 50ª conversa tem atividade às 10:11.
      h.tables.chat_messages = () => ({ data: [{ created_at: at("10:11") }], error: null });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("10:11"), exact: true });
      expect(h.chains.chat_conversations).toHaveLength(1);
    });

    it("passo cheio em que só o atendente escreveu por último: desce mais um passo e acha a mais nova", async () => {
      // 1º passo: 50 conversas ativas até 10:11, e a recebida mais nova delas é das 09:00.
      // 2º passo: 10 conversas mais antigas, com uma recebida às 09:30.
      h.tables.chat_conversations = (calls) => ({
        data: has(calls, "range", 0, 49) ? conversations(50, 0, "a") : conversations(10, 60, "b"),
        error: null,
      });
      h.tables.chat_messages = (calls) => ({
        data: [{ created_at: has(calls, "in", "conversation_id", conversations(50, 0, "a").map((c) => c.id)) ? at("09:00") : at("09:30") }],
        error: null,
      });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("09:30"), exact: true });
      expect(h.chains.chat_conversations).toHaveLength(2);
      expect(has(h.chains.chat_conversations[1], "range", 50, 99)).toBe(true);
    });

    it("a mais nova continua sendo a do 1º passo quando o 2º só tem mais antigas", async () => {
      h.tables.chat_conversations = (calls) => ({
        data: has(calls, "range", 0, 49) ? conversations(50, 0, "a") : conversations(10, 60, "b"),
        error: null,
      });
      h.tables.chat_messages = (calls) => ({
        data: [{ created_at: has(calls, "in", "conversation_id", conversations(50, 0, "a").map((c) => c.id)) ? at("09:00") : at("08:00") }],
        error: null,
      });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("09:00"), exact: true });
    });

    it("três passos cheios sem prova: devolve a mais nova que achou, marcada como não exata", async () => {
      h.tables.chat_conversations = (calls) => {
        const step = [0, 50, 100].findIndex((from) => has(calls, "range", from, from + 49));
        return { data: conversations(50, step * 50, `s${step}-`), error: null };
      };
      // Em todo passo, a recebida mais nova é mais antiga que qualquer atividade vista.
      h.tables.chat_messages = () => ({ data: [{ created_at: at("05:00") }], error: null });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("05:00"), exact: false });
      expect(h.chains.chat_conversations).toHaveLength(3);
      expect(has(h.chains.chat_conversations[2], "range", 100, 149)).toBe(true);
    });

    it("três passos cheios sem nenhuma mensagem recebida: nulo, e não exato", async () => {
      h.tables.chat_conversations = () => ({ data: conversations(50, 0), error: null });
      h.tables.chat_messages = () => ({ data: [], error: null });

      expect((await getIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: false });
    });

    it.each([
      ["das conversas", "chat_conversations"],
      ["das mensagens", "chat_messages"],
    ])("a leitura %s falha: `unavailable`, e não \"nunca chegou mensagem\"", async (_label, table) => {
      h.tables[table] = () => ({ data: null, error: { message: "statement timeout", code: "57014" } });

      const health = await getIntegrationHealth(NOW);

      expect(health.lastInbound).toEqual({ state: "unavailable" });
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
    });
  });

  describe("parte que lança em vez de devolver erro", () => {
    it.each([
      ["a leitura das conversas", "chat_conversations", "lastInbound"],
      ["a leitura das mensagens", "chat_messages", "lastInbound"],
    ] as const)("%s lança: só essa parte fica `unavailable`", async (_label, table, part) => {
      h.tables[table] = () => {
        throw new Error("socket hang up");
      };

      const health = await getIntegrationHealth(NOW);

      expect(health[part]).toEqual({ state: "unavailable" });
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
      expect(health.api.calls).toMatchObject({ state: "ok", total: 500 });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: última mensagem", "socket hang up");
    });

    it("o registro lança: repasse e API ficam `unavailable`, e o WhatsApp e a última mensagem seguem", async () => {
      h.tables.integration_logs = () => {
        throw new Error("socket hang up");
      };

      const health = await getIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "unavailable" });
      expect(health.api.calls).toEqual({ state: "unavailable" });
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
      expect(health.lastInbound).toEqual({ state: "ok", at: at("10:59"), exact: true });
    });

    it("a leitura da configuração do agente lança: `unreadable`, e o resto segue", async () => {
      relayConfigMock.mockRejectedValue(new Error("inesperado"));

      const health = await getIntegrationHealth(NOW);

      expect(health.relay.config).toBe("unreadable");
      expect(health.relay.deliveries).toMatchObject({ state: "ok", total: 40 });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: agente", "inesperado");
    });
  });

  it("sem o Supabase configurado: tudo `unavailable`, mas o estado do agente ainda é dito", async () => {
    hasEnvMock.mockReturnValue(false);
    clientMock.mockClear();
    relayConfigMock.mockResolvedValue({ configuredUrl: null, state: "none", reason: null });

    expect(await getIntegrationHealth(NOW)).toEqual({
      generatedAt: "2026-10-01T12:00:00.000Z",
      windowHours: 24,
      whatsapp: { state: "unavailable" },
      lastInbound: { state: "unavailable" },
      relay: { config: "none", deliveries: { state: "unavailable" } },
      api: { calls: { state: "unavailable" } },
    });
    expect(clientMock).not.toHaveBeenCalled();
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("sem `now` informado, a janela conta de agora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const health = await getIntegrationHealth();

    expect(health.generatedAt).toBe("2026-10-01T12:00:00.000Z");
    for (const calls of countChains()) expect(has(calls, "gte", "created_at", SINCE)).toBe(true);
    vi.useRealTimers();
  });
});
