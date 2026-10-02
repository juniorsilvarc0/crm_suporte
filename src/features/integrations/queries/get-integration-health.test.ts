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
  HEALTH_TTL_MS,
  HEALTH_WINDOW_HOURS,
  readIntegrationHealth,
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

/** `n` conversas, da mais recente para a mais antiga: a 1ª às 11:00, uma por minuto para trás. */
function conversations(n: number) {
  return Array.from({ length: n }, (_, index) => ({
    id: `c${index + 1}`,
    last_message_at: new Date(Date.UTC(2026, 9, 1, 11, 0) - index * 60_000).toISOString(),
  }));
}

/** A consulta de mensagens que só olha a partir de uma data (o passo que prova). */
const sinceOf = (calls: Call[]) =>
  calls.find(([method, column]) => method === "gte" && column === "created_at")?.[2] as string | undefined;

/** O que foi para o log de falha com o rótulo dado. */
const logged = (label: string) =>
  vi.mocked(console.error).mock.calls.filter(([first]) => first === `getIntegrationHealth: ${label}`);

const countChains = () => (h.chains.integration_logs ?? []).filter(isCount);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  hasEnvMock.mockReturnValue(true);
  relayConfigMock.mockResolvedValue({ configuredUrl: "https://agente.exemplo.com/webhook", state: "active", reason: null });
  integrationMock.mockResolvedValue(INTEGRATION);
  statusMock.mockResolvedValue({ connected: true, state: "open", owner: "5511999990000" });
  h.tables.integration_logs = logs();
  h.tables.chat_conversations = () => ({ data: conversations(2), error: null });
  h.tables.chat_messages = () => ({ data: [{ created_at: at("10:59") }], error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readIntegrationHealth", () => {
  it("tudo respondendo: o estado do WhatsApp, a última mensagem recebida e as contagens das últimas 24 h", async () => {
    expect(await readIntegrationHealth(NOW)).toEqual({
      generatedAt: "2026-10-01T12:00:00.000Z",
      windowHours: 24,
      whatsapp: { state: "open", instance: "5511999990000" },
      lastInbound: { state: "ok", at: at("10:59"), exact: true },
      relay: {
        config: "active",
        reason: null,
        deliveries: { state: "ok", total: 40, errors: 3, lastOkAt: at("11:58"), lastErrorAt: at("09:10") },
      },
      api: { calls: { state: "ok", total: 500, clientErrors: 12, serverErrors: 2 } },
    });
    expect(HEALTH_WINDOW_HOURS).toBe(24);
  });

  describe("repasse ao agente", () => {
    it("conta só os repasses de mensagem: o teste de conexão e a trilha da chave usam o mesmo provider", async () => {
      await readIntegrationHealth(NOW);

      const relay = (h.chains.integration_logs ?? []).filter((calls) => eqValue(calls, "provider") === "relay");
      // Total, erros, último que deu certo e último que falhou.
      expect(relay).toHaveLength(4);
      for (const calls of relay) expect(where(calls, "action", RELAY_EVENT)).toBe(true);
    });

    it("as contagens e as datas do último repasse valem para as últimas 24 h", async () => {
      await readIntegrationHealth(NOW);

      for (const calls of h.chains.integration_logs ?? []) expect(has(calls, "gte", "created_at", SINCE)).toBe(true);
      const last = (h.chains.integration_logs ?? []).filter((calls) => !isCount(calls));
      expect(last).toHaveLength(2);
      for (const calls of last) {
        expect(has(calls, "select", "created_at")).toBe(true);
        expect(has(calls, "order", "created_at", { ascending: false })).toBe(true);
        expect(has(calls, "limit", 1)).toBe(true);
      }
      expect(last.map((calls) => eqValue(calls, "status")).sort()).toEqual(["error", "ok"]);
    });

    it("erros contam só o status `error`, e o total não filtra status", async () => {
      await readIntegrationHealth(NOW);

      const relayCounts = countChains().filter((calls) => eqValue(calls, "provider") === "relay");
      expect(relayCounts.map((calls) => eqValue(calls, "status")).sort()).toEqual(["error", undefined]);
    });

    it("nenhum repasse na janela: zeros de verdade, e sem data", async () => {
      h.tables.integration_logs = logs({ ...COUNTS, relayTotal: 0, relayErrors: 0 }, { ok: null, error: null });

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "ok", total: 0, errors: 0, lastOkAt: null, lastErrorAt: null });
    });

    it("leva o estado da configuração do agente e o motivo da recusa, inclusive quando ela não pôde ser lida", async () => {
      for (const [state, reason] of [
        ["none", null],
        ["refused", "O endereço aponta para uma rede interna."],
        ["unreadable", null],
      ] as const) {
        relayConfigMock.mockResolvedValue({ configuredUrl: null, state, reason });

        const { relay } = await readIntegrationHealth(NOW);

        expect([relay.config, relay.reason]).toEqual([state, reason]);
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

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "unavailable" });
      expect(health.api.calls).toEqual({ state: "ok", total: 500, clientErrors: 12, serverErrors: 2 });
    });

    it("a falha vai para o log com código e mensagem", async () => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        isCount(calls) && where(calls, "status", "error")
          ? { data: null, error: { message: "statement timeout", code: "57014" } }
          : answer(calls);

      await readIntegrationHealth(NOW);

      expect(logged("contagem")).toHaveLength(1);
      expect(logged("contagem")[0].slice(1, 3)).toEqual(["57014", "statement timeout"]);
    });

    it("contagem que volta sem número é tratada como falha", async () => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        isCount(calls) && eqValue(calls, "provider") === "relay" ? ({ data: null, error: null, count: null } as Result) : answer(calls);

      expect((await readIntegrationHealth(NOW)).relay.deliveries).toEqual({ state: "unavailable" });
      expect(logged("contagem").length).toBeGreaterThan(0);
    });

    it("conta de verdade (`exact`), sem trazer linha nenhuma", async () => {
      await readIntegrationHealth(NOW);

      expect(countChains()).toHaveLength(5);
      for (const calls of countChains()) expect(has(calls, "select", "id", { count: "exact", head: true })).toBe(true);
    });
  });

  describe("API v1", () => {
    it("separa o erro de quem chama (4xx) do erro do CRM (5xx)", async () => {
      await readIntegrationHealth(NOW);

      const api = countChains().filter((calls) => eqValue(calls, "provider") === "api_v1");
      expect(api).toHaveLength(3);
      expect(api.filter((calls) => has(calls, "gte", "http_status", 400) && has(calls, "lt", "http_status", 500))).toHaveLength(1);
      expect(api.filter((calls) => has(calls, "gte", "http_status", 500) && !has(calls, "lt", "http_status", 500))).toHaveLength(1);
      // O total não filtra pelo status HTTP nem pelo desfecho: conta toda chamada.
      const total = api.filter((calls) => !calls.some(([, column]) => column === "http_status"));
      expect(total).toHaveLength(1);
      expect(total[0].filter(([method]) => method === "eq")).toEqual([["eq", "provider", "api_v1"]]);
    });

    it.each([
      ["o total", (calls: Call[]) => !calls.some(([, column]) => column === "http_status")],
      ["os 4xx", (calls: Call[]) => has(calls, "lt", "http_status", 500)],
      ["os 5xx", (calls: Call[]) => has(calls, "gte", "http_status", 500)],
    ])("a contagem d%s falha: a API fica `unavailable`, e o repasse segue contado", async (_label, fails) => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        isCount(calls) && eqValue(calls, "provider") === "api_v1" && fails(calls)
          ? { data: null, error: { message: "statement timeout" } }
          : answer(calls);

      const health = await readIntegrationHealth(NOW);

      expect(health.api.calls).toEqual({ state: "unavailable" });
      expect(health.relay.deliveries).toMatchObject({ state: "ok", total: 40 });
    });
  });

  describe("WhatsApp", () => {
    it("consulta o provedor com a URL e o token da integração, e só lê", async () => {
      await readIntegrationHealth(NOW);

      expect(statusMock).toHaveBeenCalledTimes(1);
      expect(statusMock).toHaveBeenCalledWith("https://demo.invalid", "token-de-mentira");
      // Nada é gravado: o telefone do dono é assunto de /api/connection/state.
      expect(h.chains.chat_integrations).toBeUndefined();
    });

    it.each(["connecting", "close", "unknown"] as const)("repassa o estado `%s`", async (state) => {
      statusMock.mockResolvedValue({ connected: false, state, owner: null });

      expect((await readIntegrationHealth(NOW)).whatsapp).toEqual({ state, instance: "5511888880000" });
    });

    it("sem o dono na resposta do provedor, mostra o telefone guardado; sem nenhum, nulo", async () => {
      statusMock.mockResolvedValue({ connected: true, state: "open", owner: null });
      expect((await readIntegrationHealth(NOW)).whatsapp).toEqual({ state: "open", instance: "5511888880000" });

      integrationMock.mockResolvedValue({ ...INTEGRATION, phone_number: null });
      expect((await readIntegrationHealth(NOW)).whatsapp).toEqual({ state: "open", instance: null });
    });

    it("sem integração: `not_configured`, sem chamar o provedor", async () => {
      integrationMock.mockResolvedValue(null);

      expect((await readIntegrationHealth(NOW)).whatsapp).toEqual({ state: "not_configured" });
      expect(statusMock).not.toHaveBeenCalled();
    });

    it("o provedor não responde: `unavailable` por causa do provedor, e o motivo vai só para o log", async () => {
      statusMock.mockRejectedValue(new Error("uazapi status 500: corpo da resposta"));

      const health = await readIntegrationHealth(NOW);

      expect(health.whatsapp).toEqual({ state: "unavailable", cause: "provider", instance: "5511888880000" });
      expect(JSON.stringify(health)).not.toContain("corpo da resposta");
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: provedor", "uazapi status 500: corpo da resposta");
      // As outras partes não dependem do provedor.
      expect(health.api.calls).toMatchObject({ state: "ok" });
      expect(health.lastInbound).toMatchObject({ state: "ok" });
    });

    it("a leitura da integração falha: `unavailable` por causa do CRM, sem chamar o provedor", async () => {
      integrationMock.mockRejectedValue(new Error("vault indisponível"));

      expect((await readIntegrationHealth(NOW)).whatsapp).toEqual({ state: "unavailable", cause: "crm", instance: null });
      expect(statusMock).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: integração", "vault indisponível");
    });

    it("o token da integração não aparece na resposta", async () => {
      expect(JSON.stringify(await readIntegrationHealth(NOW))).not.toContain("token-de-mentira");
    });
  });

  describe("última mensagem recebida", () => {
    it("procura nas 50 conversas mais recentes, só mensagem RECEBIDA e não apagada, a mais nova", async () => {
      await readIntegrationHealth(NOW);

      const convs = h.lastChain("chat_conversations");
      expect(has(convs, "select", "id, last_message_at")).toBe(true);
      expect(has(convs, "not", "last_message_at", "is", null)).toBe(true);
      expect(has(convs, "order", "last_message_at", { ascending: false })).toBe(true);
      expect(has(convs, "order", "id", { ascending: false })).toBe(true);
      expect(has(convs, "limit", 50)).toBe(true);
      const messages = h.lastChain("chat_messages");
      expect(where(messages, "direction", "inbound")).toBe(true);
      expect(where(messages, "is_deleted", false)).toBe(true);
      expect(has(messages, "in", "conversation_id", ["c1", "c2"])).toBe(true);
      expect(has(messages, "order", "created_at", { ascending: false })).toBe(true);
      expect(has(messages, "limit", 1)).toBe(true);
    });

    it("nenhuma conversa: nunca chegou mensagem, e isso é exato", async () => {
      h.tables.chat_conversations = () => ({ data: [], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: true });
      expect(h.chains.chat_messages).toBeUndefined();
    });

    it("menos de 50 conversas: todas foram lidas, e o que se achar é exato, num passo só e sem data mínima", async () => {
      h.tables.chat_conversations = () => ({ data: conversations(49), error: null });
      h.tables.chat_messages = () => ({ data: [], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: true });
      expect(h.chains.chat_messages).toHaveLength(1);
      expect(sinceOf(h.chains.chat_messages[0])).toBeUndefined();
    });

    it("50 conversas e mensagem achada a partir da atividade da última delas: exato, num passo só", async () => {
      const convs = conversations(50);
      h.tables.chat_conversations = () => ({ data: convs, error: null });
      h.tables.chat_messages = () => ({ data: [{ created_at: at("10:30") }], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("10:30"), exact: true });
      expect(h.chains.chat_messages).toHaveLength(1);
      // Só interessa mensagem a partir da atividade da conversa mais antiga do passo.
      expect(sinceOf(h.chains.chat_messages[0])).toBe(convs[49].last_message_at);
    });

    it("50 conversas e nada a partir da última atividade: a mais nova delas, marcada como piso (`exact: false`)", async () => {
      h.tables.chat_conversations = () => ({ data: conversations(50), error: null });
      h.tables.chat_messages = (calls) => ({ data: sinceOf(calls) ? [] : [{ created_at: at("05:00") }], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("05:00"), exact: false });
      expect(h.chains.chat_messages).toHaveLength(2);
      expect(sinceOf(h.chains.chat_messages[1])).toBeUndefined();
      expect(has(h.chains.chat_messages[1], "in", "conversation_id", conversations(50).map((c) => c.id))).toBe(true);
    });

    it("50 conversas e nenhuma mensagem recebida em nenhuma: nulo, e não exato", async () => {
      h.tables.chat_conversations = () => ({ data: conversations(50), error: null });
      h.tables.chat_messages = () => ({ data: [], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: false });
    });

    it.each([
      ["das conversas", (table: string) => table === "chat_conversations"],
      ["das mensagens, no passo que prova", (table: string, calls: Call[]) => table === "chat_messages" && Boolean(sinceOf(calls))],
      ["das mensagens, no passo do piso", (table: string, calls: Call[]) => table === "chat_messages" && !sinceOf(calls)],
    ])("a leitura %s falha: `unavailable`, e não \"nunca chegou mensagem\"", async (_label, fails) => {
      h.tables.chat_conversations = (calls) =>
        fails("chat_conversations", calls)
          ? { data: null, error: { message: "statement timeout", code: "57014" } }
          : { data: conversations(50), error: null };
      h.tables.chat_messages = (calls) =>
        fails("chat_messages", calls)
          ? { data: null, error: { message: "statement timeout", code: "57014" } }
          : { data: [], error: null };

      const health = await readIntegrationHealth(NOW);

      expect(health.lastInbound).toEqual({ state: "unavailable" });
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
    });
  });

  describe("parte que lança em vez de devolver erro", () => {
    it.each([
      ["a leitura das conversas", "chat_conversations"],
      ["a leitura das mensagens", "chat_messages"],
    ] as const)("%s lança: só a última mensagem fica `unavailable`", async (_label, table) => {
      h.tables[table] = () => {
        throw new Error("socket hang up");
      };

      const health = await readIntegrationHealth(NOW);

      expect(health.lastInbound).toEqual({ state: "unavailable" });
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
      expect(health.api.calls).toMatchObject({ state: "ok", total: 500 });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: última mensagem", "socket hang up");
    });

    it("o registro lança: repasse e API ficam `unavailable`, e o WhatsApp e a última mensagem seguem", async () => {
      h.tables.integration_logs = () => {
        throw new Error("socket hang up");
      };

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "unavailable" });
      expect(health.api.calls).toEqual({ state: "unavailable" });
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
      expect(health.lastInbound).toEqual({ state: "ok", at: at("10:59"), exact: true });
    });

    it("a leitura da configuração do agente lança: `unreadable`, e o resto segue", async () => {
      relayConfigMock.mockRejectedValue(new Error("inesperado"));

      const health = await readIntegrationHealth(NOW);

      expect([health.relay.config, health.relay.reason]).toEqual(["unreadable", null]);
      expect(health.relay.deliveries).toMatchObject({ state: "ok", total: 40 });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: agente", "inesperado");
    });

    it("o provedor lança algo que não é Error: o WhatsApp fica `unavailable`, e nada rejeita", async () => {
      integrationMock.mockImplementation(() => {
        throw "falha crua";
      });

      const health = await readIntegrationHealth(NOW);

      expect(health.whatsapp).toEqual({ state: "unavailable", cause: "crm", instance: null });
    });
  });

  it("sem o Supabase configurado: nada é lido, nem a configuração do agente", async () => {
    hasEnvMock.mockReturnValue(false);
    clientMock.mockClear();

    expect(await readIntegrationHealth(NOW)).toEqual({
      generatedAt: "2026-10-01T12:00:00.000Z",
      windowHours: 24,
      whatsapp: { state: "unavailable", cause: "crm", instance: null },
      lastInbound: { state: "unavailable" },
      relay: { config: "unreadable", reason: null, deliveries: { state: "unavailable" } },
      api: { calls: { state: "unavailable" } },
    });
    expect(clientMock).not.toHaveBeenCalled();
    expect(statusMock).not.toHaveBeenCalled();
    expect(relayConfigMock).not.toHaveBeenCalled();
  });

  it("o cliente do Supabase não sobe: o mesmo resultado, com o motivo no log", async () => {
    clientMock.mockImplementationOnce(() => {
      throw new Error("chave ausente");
    });

    const health = await readIntegrationHealth(NOW);

    expect(health.lastInbound).toEqual({ state: "unavailable" });
    expect(health.relay.config).toBe("unreadable");
    expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: cliente", "chave ausente");
  });

  it("sem `now` informado, a janela conta de agora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const health = await readIntegrationHealth();

    expect(health.generatedAt).toBe("2026-10-01T12:00:00.000Z");
    for (const calls of countChains()) expect(has(calls, "gte", "created_at", SINCE)).toBe(true);
    vi.useRealTimers();
  });
});

describe("getIntegrationHealth (a leitura serve a todos por alguns segundos)", () => {
  // O resultado guardado vive no módulo: cada teste usa um instante distante
  // do anterior, para começar sem leitura válida.
  let base = Date.UTC(2026, 10, 1, 12, 0);
  const nextBase = () => {
    base += 3_600_000;
    return base;
  };

  it("dois pedidos em menos de 10 s fazem uma leitura só, e levam o mesmo `generatedAt`", async () => {
    const t0 = nextBase();

    const first = await getIntegrationHealth(new Date(t0));
    const second = await getIntegrationHealth(new Date(t0 + HEALTH_TTL_MS - 1));

    expect(HEALTH_TTL_MS).toBe(10_000);
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(second.generatedAt).toBe(new Date(t0).toISOString());
  });

  it("depois de 10 s lê de novo", async () => {
    const t0 = nextBase();

    await getIntegrationHealth(new Date(t0));
    const later = await getIntegrationHealth(new Date(t0 + HEALTH_TTL_MS));

    expect(statusMock).toHaveBeenCalledTimes(2);
    expect(later.generatedAt).toBe(new Date(t0 + HEALTH_TTL_MS).toISOString());
  });

  it("pedidos simultâneos dividem a mesma leitura em curso", async () => {
    const t0 = nextBase();

    const [a, b] = await Promise.all([getIntegrationHealth(new Date(t0)), getIntegrationHealth(new Date(t0 + 5))]);

    expect(a).toBe(b);
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(h.chains.chat_conversations).toHaveLength(1);
  });

  it("um relógio que volta atrás não reaproveita a leitura guardada", async () => {
    const t0 = nextBase();

    await getIntegrationHealth(new Date(t0));
    await getIntegrationHealth(new Date(t0 - 1));

    expect(statusMock).toHaveBeenCalledTimes(2);
  });
});
