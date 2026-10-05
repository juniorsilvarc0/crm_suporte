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
  readIntegrationHealth,
} from "@/features/integrations/queries/get-integration-health";
import { HEALTH_TTL_MS } from "@/features/integrations/types";
import { UnsafeUrlError } from "@/lib/security/ssrf-guard";

const h = createHarness(clientMock);

const NOW = new Date("2026-10-01T12:00:00.000Z");
const SINCE = "2026-09-30T12:00:00.000Z";
const RELAY_EVENT = "conversation.message_received";
const INTEGRATION = { id: "integracao-1", apiUrl: "https://demo.invalid", token: "token-de-mentira", phone_number: "5511888880000" };
const DB_DOWN = { data: null, error: { message: "statement timeout", code: "57014" }, status: 500 } as Result;
// O que o supabase-js devolve quando o pedido nem chega ao banco: código vazio,
// "fetch failed" na mensagem, a causa em `details`, e status 0.
const NETWORK_DETAILS = "TypeError: fetch failed\n\nCaused by: Error: connect ECONNREFUSED 127.0.0.1:54321 (ECONNREFUSED)";
const NETWORK_DOWN = {
  data: null,
  error: { message: "TypeError: fetch failed", details: NETWORK_DETAILS, hint: "", code: "" },
  count: null,
  status: 0,
} as Result;

// Instantes como o PostgREST os devolve: microssegundos e `+00:00`, e não o `Z` do JavaScript.
const at = (hhmm: string) => `2026-10-01T${hhmm}:00.123456+00:00`;
const isCount = (calls: Call[]) =>
  calls.some(([method, , options]) => method === "select" && (options as { head?: boolean } | undefined)?.head === true);
const eqValue = (calls: Call[], column: string) => calls.find(([method, name]) => method === "eq" && name === column)?.[2];
/** O instante a partir do qual a consulta procura, ou `undefined` se ela não tem piso. */
const sinceOf = (calls: Call[]) => calls.find(([method, column]) => method === "gte" && column === "created_at")?.[2];

type Counts = { relayTotal: number; relayErrors: number; apiTotal: number; api4xx: number; api5xx: number };
const COUNTS: Counts = { relayTotal: 40, relayErrors: 3, apiTotal: 500, api4xx: 12, api5xx: 2 };

/** Responde às sete leituras de `integration_logs` olhando os filtros de cada uma. */
function logs(counts: Counts = COUNTS, last: { ok: string | null; error: string | null } = { ok: at("11:58"), error: at("09:10") }) {
  return (calls: Call[]): Result => {
    if (!isCount(calls)) {
      const value = eqValue(calls, "status") === "ok" ? last.ok : last.error;
      return { data: value ? [{ created_at: value }] : [], error: null };
    }
    let count: number;
    if (eqValue(calls, "provider") === "relay") {
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

/** `n` conversas, da mais recente (11:00) para a mais antiga, um minuto entre cada. */
function conversations(n: number) {
  return Array.from({ length: n }, (_, index) => ({
    id: `c${index + 1}`,
    last_message_at: new Date(Date.UTC(2026, 9, 1, 11, 0) - index * 60_000).toISOString().replace(".000Z", ".123456+00:00"),
  }));
}
const idsOf = (list: { id: string }[]) => list.map((conversation) => conversation.id);

const logChains = () => h.chains.integration_logs ?? [];
const messageChains = () => h.chains.chat_messages ?? [];
/** As cadeias, para comparar o conjunto sem depender da ordem em que as consultas partiram. */
const sorted = (chains: Call[][]) => chains.map((chain) => JSON.stringify(chain)).sort();

// As consultas INTEIRAS, chamada a chamada. Conferir só que cada condição está
// lá deixa passar uma condição a mais: e uma condição a mais muda o número.
const countChain = (provider: string, ...narrow: Call[]): Call[] => [
  ["select", "id", { count: "exact", head: true }],
  ["eq", "provider", provider],
  ["gte", "created_at", SINCE],
  ...narrow,
];
const lastRelayChain = (outcome: "ok" | "error"): Call[] => [
  ["select", "created_at"],
  ["eq", "provider", "relay"],
  ["eq", "action", RELAY_EVENT],
  ["eq", "status", outcome],
  ["gte", "created_at", SINCE],
  ["order", "created_at", { ascending: false }],
  ["limit", 1],
];
const CONVERSATIONS_CHAIN: Call[] = [
  ["select", "id, last_message_at"],
  ["not", "last_message_at", "is", null],
  ["order", "last_message_at", { ascending: false }],
  ["order", "id", { ascending: false }],
  ["limit", 51],
];
const messagesChain = (ids: string[], since?: string): Call[] => [
  ["select", "created_at"],
  ["eq", "direction", "inbound"],
  ["eq", "is_deleted", false],
  ["in", "conversation_id", ids],
  ...(since === undefined ? [] : [["gte", "created_at", since] satisfies Call]),
  ["order", "created_at", { ascending: false }],
  ["limit", 1],
];

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
  vi.useRealTimers();
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
    expect(console.error).not.toHaveBeenCalled();
  });

  describe("repasse ao agente", () => {
    it("as quatro leituras: só os repasses de mensagem, só as últimas 24 h, e nenhuma condição além dessas", async () => {
      await readIntegrationHealth(NOW);

      const relay = logChains().filter((calls) => eqValue(calls, "provider") === "relay");
      expect(sorted(relay)).toEqual(
        sorted([
          // O teste de conexão (`webhook.ping`) e a trilha da chave usam o mesmo
          // provider: é a AÇÃO que separa a entrega. O total não filtra status.
          countChain("relay", ["eq", "action", RELAY_EVENT]),
          countChain("relay", ["eq", "action", RELAY_EVENT], ["eq", "status", "error"]),
          // As datas do último acerto e do último erro têm a mesma janela.
          lastRelayChain("ok"),
          lastRelayChain("error"),
        ])
      );
    });

    it("ao todo, sete leituras do registro: quatro do repasse e três da API", async () => {
      await readIntegrationHealth(NOW);

      expect(logChains()).toHaveLength(7);
    });

    it("nenhum repasse na janela: zeros de verdade, e sem data", async () => {
      h.tables.integration_logs = logs({ ...COUNTS, relayTotal: 0, relayErrors: 0 }, { ok: null, error: null });

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "ok", total: 0, errors: 0, lastOkAt: null, lastErrorAt: null });
    });

    it("a data do último acerto e a do último erro não se trocam", async () => {
      h.tables.integration_logs = logs(COUNTS, { ok: at("08:00"), error: null });

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toMatchObject({ lastOkAt: at("08:00"), lastErrorAt: null });
    });

    it("leva o estado da configuração do agente e, quando a URL é recusada, o motivo", async () => {
      relayConfigMock.mockResolvedValue({ configuredUrl: "http://10.0.0.5/hook", state: "refused", reason: "A URL precisa ser HTTPS." });

      const health = await readIntegrationHealth(NOW);

      expect(health.relay).toMatchObject({ config: "refused", reason: "A URL precisa ser HTTPS." });
      // A URL em si pode levar segredo no caminho: não sai.
      expect(JSON.stringify(health)).not.toContain("10.0.0.5");
    });

    it.each(["none", "unreadable"] as const)("configuração `%s`: repassada como veio", async (state) => {
      relayConfigMock.mockResolvedValue({ configuredUrl: null, state, reason: null });

      expect((await readIntegrationHealth(NOW)).relay).toMatchObject({ config: state, reason: null });
    });

    it.each([
      ["a contagem do total", (calls: Call[]) => isCount(calls) && eqValue(calls, "provider") === "relay" && !where(calls, "status", "error")],
      ["a contagem dos erros", (calls: Call[]) => isCount(calls) && where(calls, "status", "error")],
      ["a leitura do último que deu certo", (calls: Call[]) => !isCount(calls) && where(calls, "status", "ok")],
      ["a leitura do último que falhou", (calls: Call[]) => !isCount(calls) && where(calls, "status", "error")],
    ])("%s falha: o repasse fica `unavailable` (e não zero), e a API segue contada", async (_label, fails) => {
      const answer = logs();
      h.tables.integration_logs = (calls) => (fails(calls) ? DB_DOWN : answer(calls));

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "unavailable" });
      expect(health.relay.config).toBe("active");
      expect(health.api.calls).toEqual({ state: "ok", total: 500, clientErrors: 12, serverErrors: 2 });
    });

    it("contagem que volta sem número é tratada como falha", async () => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        isCount(calls) && eqValue(calls, "provider") === "relay"
          ? ({ data: null, error: null, count: null, status: 200 } as Result)
          : answer(calls);

      expect((await readIntegrationHealth(NOW)).relay.deliveries).toEqual({ state: "unavailable" });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: contagem", undefined, undefined, undefined, 200);
    });

    it("contagem recusada pelo servidor: a resposta do HEAD não tem corpo, e o status HTTP é o que sobra no log", async () => {
      const answer = logs();
      // Sem corpo para ler, o cliente monta o erro só com a mensagem vazia: nem código vem.
      h.tables.integration_logs = (calls) =>
        isCount(calls) ? ({ data: null, error: { message: "" }, count: null, status: 503 } as Result) : answer(calls);

      await readIntegrationHealth(NOW);

      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: contagem", undefined, "", undefined, 503);
    });

    it("banco fora do ar (falha de rede): o código vem vazio, e a causa que está em `details` vai para o log", async () => {
      h.tables.integration_logs = () => NETWORK_DOWN;

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "unavailable" });
      expect(health.api.calls).toEqual({ state: "unavailable" });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: contagem", "", "TypeError: fetch failed", NETWORK_DETAILS, 0);
      expect(console.error).toHaveBeenCalledWith(
        "getIntegrationHealth: último repasse",
        "",
        "TypeError: fetch failed",
        NETWORK_DETAILS,
        0
      );
    });

    it("o log da leitura do último repasse leva código, mensagem e status", async () => {
      const answer = logs();
      h.tables.integration_logs = (calls) => (isCount(calls) ? answer(calls) : DB_DOWN);

      await readIntegrationHealth(NOW);

      expect(console.error).toHaveBeenCalledWith(
        "getIntegrationHealth: último repasse",
        "57014",
        "statement timeout",
        undefined,
        500
      );
    });
  });

  describe("API v1", () => {
    it("as três contagens: o total sem filtro nenhum, os 4xx e os 5xx separados, só as últimas 24 h", async () => {
      await readIntegrationHealth(NOW);

      const api = logChains().filter((calls) => eqValue(calls, "provider") === "api_v1");
      expect(sorted(api)).toEqual(
        sorted([
          // O total não filtra pelo status HTTP nem pelo desfecho: conta toda chamada registrada.
          countChain("api_v1"),
          countChain("api_v1", ["gte", "http_status", 400], ["lt", "http_status", 500]),
          countChain("api_v1", ["gte", "http_status", 500]),
        ])
      );
    });

    it("cada número vai para o seu lugar", async () => {
      h.tables.integration_logs = logs({ ...COUNTS, apiTotal: 9, api4xx: 4, api5xx: 1 });

      expect((await readIntegrationHealth(NOW)).api.calls).toEqual({ state: "ok", total: 9, clientErrors: 4, serverErrors: 1 });
    });

    it.each([
      ["do total", (calls: Call[]) => !calls.some(([, column]) => column === "http_status")],
      ["dos 4xx", (calls: Call[]) => has(calls, "lt", "http_status", 500)],
      ["dos 5xx", (calls: Call[]) => has(calls, "gte", "http_status", 500)],
    ])("a contagem %s falha: a API fica `unavailable`, e o repasse segue contado", async (_label, fails) => {
      const answer = logs();
      h.tables.integration_logs = (calls) =>
        isCount(calls) && eqValue(calls, "provider") === "api_v1" && fails(calls) ? DB_DOWN : answer(calls);

      const health = await readIntegrationHealth(NOW);

      expect(health.api.calls).toEqual({ state: "unavailable" });
      expect(health.relay.deliveries).toMatchObject({ state: "ok", total: 40 });
    });
  });

  describe("WhatsApp", () => {
    it("consulta o provedor com a URL e o token da integração, e só lê", async () => {
      await readIntegrationHealth(NOW);

      expect(integrationMock).toHaveBeenCalledTimes(1);
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

    it("o provedor não responde: `unavailable` por causa do provedor, com o telefone guardado; o motivo vai só para o log", async () => {
      statusMock.mockRejectedValue(new Error("uazapi status 500: corpo da resposta"));

      const health = await readIntegrationHealth(NOW);

      expect(health.whatsapp).toEqual({ state: "unavailable", cause: "provider", instance: "5511888880000" });
      expect(JSON.stringify(health)).not.toContain("corpo da resposta");
      expect(console.error).toHaveBeenCalledWith(
        "getIntegrationHealth: provedor",
        "uazapi status 500: corpo da resposta",
        undefined
      );
      // As outras partes não dependem do provedor.
      expect(health.api.calls).toMatchObject({ state: "ok" });
      expect(health.lastInbound).toMatchObject({ state: "ok" });
    });

    it("a URL salva é recusada pela guarda do CRM: o provedor nem foi chamado, e a causa é o CRM", async () => {
      statusMock.mockRejectedValue(new UnsafeUrlError("A URL aponta para um host de rede interna (bloqueado)."));

      const health = await readIntegrationHealth(NOW);

      expect(health.whatsapp).toEqual({ state: "unavailable", cause: "crm", instance: "5511888880000" });
      expect(console.error).toHaveBeenCalledWith(
        "getIntegrationHealth: provedor",
        "A URL aponta para um host de rede interna (bloqueado).",
        undefined
      );
    });

    it("o pedido nem chega ao provedor (\"fetch failed\"): o motivo, que vem na causa do erro, vai para o log", async () => {
      const cause = Object.assign(new Error("getaddrinfo ENOTFOUND demo.invalid"), { code: "ENOTFOUND" });
      statusMock.mockRejectedValue(new TypeError("fetch failed", { cause }));

      const health = await readIntegrationHealth(NOW);

      expect(health.whatsapp).toEqual({ state: "unavailable", cause: "provider", instance: "5511888880000" });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: provedor", "fetch failed", cause);
      // O endereço do provedor fica no log do servidor: não vai na resposta.
      expect(JSON.stringify(health)).not.toContain("demo.invalid");
    });

    it("a leitura da integração falha: `unavailable` por causa do CRM, sem chamar o provedor", async () => {
      integrationMock.mockRejectedValue(new Error("vault indisponível"));

      expect((await readIntegrationHealth(NOW)).whatsapp).toEqual({ state: "unavailable", cause: "crm", instance: null });
      expect(statusMock).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: integração", "vault indisponível");
    });

    it("falha que não é um Error vai para o log como veio", async () => {
      statusMock.mockRejectedValue("texto solto");

      await readIntegrationHealth(NOW);

      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: provedor", "texto solto", undefined);
    });

    it("o token da integração não aparece na resposta", async () => {
      expect(JSON.stringify(await readIntegrationHealth(NOW))).not.toContain("token-de-mentira");
    });
  });

  describe("última mensagem recebida", () => {
    it("lê as conversas mais recentes (50 e mais uma) e, nelas, a mensagem RECEBIDA e não apagada mais nova", async () => {
      await readIntegrationHealth(NOW);

      expect(h.chains.chat_conversations).toEqual([CONVERSATIONS_CHAIN]);
      expect(messageChains()).toEqual([messagesChain(["c1", "c2"])]);
    });

    it("nenhuma conversa: nada foi recebido, e isso é exato", async () => {
      h.tables.chat_conversations = () => ({ data: [], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: true });
      expect(h.chains.chat_messages).toBeUndefined();
    });

    it("até 50 conversas: todas foram lidas, a busca não tem piso, e o resultado é exato mesmo sem achar nada", async () => {
      const read = conversations(50);
      h.tables.chat_conversations = () => ({ data: read, error: null });
      h.tables.chat_messages = () => ({ data: [], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: true });
      expect(messageChains()).toEqual([messagesChain(idsOf(read))]);
    });

    it("veio a 51ª: procura nas 50 primeiras, a partir da atividade dela; achou, é exato, numa consulta só", async () => {
      const read = conversations(51);
      h.tables.chat_conversations = () => ({ data: read, error: null });
      h.tables.chat_messages = () => ({ data: [{ created_at: at("10:30") }], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("10:30"), exact: true });
      // A 51ª teve atividade às 10:10: nenhuma conversa de fora das 50 tem mensagem
      // mais nova que isso. O instante vai como veio do banco, com os microssegundos.
      expect(read[50]).toEqual({ id: "c51", last_message_at: "2026-10-01T10:10:00.123456+00:00" });
      expect(messageChains()).toEqual([messagesChain(idsOf(read.slice(0, 50)), "2026-10-01T10:10:00.123456+00:00")]);
    });

    it("veio a 51ª e nada a partir daquela atividade: devolve a mais nova das 50 como piso, `exact: false`", async () => {
      const read = conversations(51);
      h.tables.chat_conversations = () => ({ data: read, error: null });
      h.tables.chat_messages = (calls) => ({
        data: sinceOf(calls) === undefined ? [{ created_at: at("09:00") }] : [],
        error: null,
      });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: at("09:00"), exact: false });
      // A 1ª consulta tem o piso; a 2ª, não, e ainda só olha mensagem recebida e não apagada das mesmas 50.
      const ids = idsOf(read.slice(0, 50));
      expect(messageChains()).toEqual([messagesChain(ids, "2026-10-01T10:10:00.123456+00:00"), messagesChain(ids)]);
    });

    it("veio a 51ª e nenhuma mensagem recebida nas 50: nulo, e não exato", async () => {
      h.tables.chat_conversations = () => ({ data: conversations(51), error: null });
      h.tables.chat_messages = () => ({ data: [], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "ok", at: null, exact: false });
      expect(messageChains()).toHaveLength(2);
    });

    it("a leitura das conversas falha: `unavailable`, e não \"nada recebido\"", async () => {
      h.tables.chat_conversations = () => DB_DOWN;

      const health = await readIntegrationHealth(NOW);

      expect(health.lastInbound).toEqual({ state: "unavailable" });
      expect(h.chains.chat_messages).toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(
        "getIntegrationHealth: conversas",
        "57014",
        "statement timeout",
        undefined,
        500
      );
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
    });

    it("banco fora do ar na leitura das conversas: a causa da falha de rede vai para o log", async () => {
      h.tables.chat_conversations = () => NETWORK_DOWN;

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "unavailable" });
      expect(console.error).toHaveBeenCalledWith(
        "getIntegrationHealth: conversas",
        "",
        "TypeError: fetch failed",
        NETWORK_DETAILS,
        0
      );
    });

    it.each([
      ["a busca com piso", (calls: Call[]) => sinceOf(calls) !== undefined, 1],
      ["a busca do piso, sem prova", (calls: Call[]) => sinceOf(calls) === undefined, 2],
    ])("%s falha: `unavailable`", async (_label, fails, queries) => {
      h.tables.chat_conversations = () => ({ data: conversations(51), error: null });
      h.tables.chat_messages = (calls) => (fails(calls) ? DB_DOWN : { data: [], error: null });

      expect((await readIntegrationHealth(NOW)).lastInbound).toEqual({ state: "unavailable" });
      expect(messageChains()).toHaveLength(queries);
      expect(console.error).toHaveBeenCalledWith(
        "getIntegrationHealth: mensagens",
        "57014",
        "statement timeout",
        undefined,
        500
      );
    });
  });

  describe("parte que lança em vez de devolver erro", () => {
    // Não é falha prevista: o erro vai INTEIRO para o log (com a pilha), e não só a mensagem.
    const boom = new Error("socket hang up");

    it.each([
      ["a leitura das conversas", "chat_conversations"],
      ["a leitura das mensagens", "chat_messages"],
    ])("%s lança: só a última mensagem fica `unavailable`", async (_label, table) => {
      h.tables[table] = () => {
        throw boom;
      };

      const health = await readIntegrationHealth(NOW);

      expect(health.lastInbound).toEqual({ state: "unavailable" });
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
      expect(health.api.calls).toMatchObject({ state: "ok", total: 500 });
      expect(health.relay.deliveries).toMatchObject({ state: "ok", total: 40 });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: última mensagem", boom);
    });

    it("o registro lança: repasse e API ficam `unavailable`, e o WhatsApp e a última mensagem seguem", async () => {
      h.tables.integration_logs = () => {
        throw boom;
      };

      const health = await readIntegrationHealth(NOW);

      expect(health.relay.deliveries).toEqual({ state: "unavailable" });
      expect(health.api.calls).toEqual({ state: "unavailable" });
      expect(health.relay.config).toBe("active");
      expect(health.whatsapp).toEqual({ state: "open", instance: "5511999990000" });
      expect(health.lastInbound).toEqual({ state: "ok", at: at("10:59"), exact: true });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: repasse", boom);
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: api", boom);
    });

    it("a leitura da configuração do agente lança: `unreadable`, e o resto segue", async () => {
      const unexpected = new Error("inesperado");
      relayConfigMock.mockRejectedValue(unexpected);

      const health = await readIntegrationHealth(NOW);

      expect(health.relay).toMatchObject({ config: "unreadable", reason: null });
      expect(health.relay.deliveries).toMatchObject({ state: "ok", total: 40 });
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: agente", unexpected);
    });

    it("o que foi lançado não é um Error: vai para o log como veio", async () => {
      relayConfigMock.mockRejectedValue("texto solto");

      await readIntegrationHealth(NOW);

      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: agente", "texto solto");
    });
  });

  describe("sem banco", () => {
    const NOTHING_READ = {
      generatedAt: "2026-10-01T12:00:00.000Z",
      windowHours: 24,
      whatsapp: { state: "unavailable", cause: "crm", instance: null },
      lastInbound: { state: "unavailable" },
      // Nada foi lido, nem a configuração do agente: não é "sem agente".
      relay: { config: "unreadable", reason: null, deliveries: { state: "unavailable" } },
      api: { calls: { state: "unavailable" } },
    };

    it("sem o Supabase configurado: tudo `unavailable`, sem criar o cliente nem chamar ninguém", async () => {
      hasEnvMock.mockReturnValue(false);

      expect(await readIntegrationHealth(NOW)).toEqual(NOTHING_READ);
      expect(clientMock).not.toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
      expect(relayConfigMock).not.toHaveBeenCalled();
    });

    it("criar o cliente lança: tudo `unavailable`, sem rejeitar, com o motivo no log", async () => {
      clientMock.mockImplementation(() => {
        throw new Error("SUPABASE_URL inválida");
      });

      expect(await readIntegrationHealth(NOW)).toEqual(NOTHING_READ);
      expect(console.error).toHaveBeenCalledWith("getIntegrationHealth: cliente", "SUPABASE_URL inválida");
      expect(statusMock).not.toHaveBeenCalled();
    });
  });

  it("sem `now` informado, a hora da leitura e a janela contam de agora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const health = await readIntegrationHealth();

    expect(health.generatedAt).toBe("2026-10-01T12:00:00.000Z");
    for (const calls of logChains()) expect(sinceOf(calls)).toBe(SINCE);
  });
});

// A leitura guardada mora no módulo e atravessa os testes: cada teste daqui usa
// um horário à frente do anterior, para não receber a leitura de outro.
describe("getIntegrationHealth: no máximo uma leitura começa a cada 10 segundos", () => {
  const base = (hour: number) => new Date(Date.UTC(2026, 9, 2, hour, 0, 0));
  const later = (from: Date, ms: number) => new Date(from.getTime() + ms);
  const reads = () => (h.chains.chat_conversations ?? []).length;
  const OPEN = { connected: true, state: "open", owner: "5511999990000" };

  /** O provedor fica sem responder até `release()`: a leitura fica em curso. */
  function holdProvider() {
    let release!: () => void;
    const answer = new Promise<typeof OPEN>((resolve) => {
      release = () => resolve(OPEN);
    });
    statusMock.mockReturnValue(answer);
    return { release };
  }
  /** Espera a leitura chegar ao provedor `times` vezes: aí ela está de fato em curso. */
  const untilProviderCalled = (times: number) => vi.waitFor(() => expect(statusMock).toHaveBeenCalledTimes(times));

  it("o prazo é de 10 segundos", () => {
    expect(HEALTH_TTL_MS).toBe(10_000);
  });

  it("dois pedidos dentro do prazo: uma leitura só, e a mesma hora de leitura", async () => {
    const first = await getIntegrationHealth(base(1));
    const second = await getIntegrationHealth(later(base(1), HEALTH_TTL_MS - 1));

    expect(second).toBe(first);
    expect(second.generatedAt).toBe("2026-10-02T01:00:00.000Z");
    expect(reads()).toBe(1);
    expect(statusMock).toHaveBeenCalledTimes(1);
  });

  it("vencido o prazo, lê de novo", async () => {
    await getIntegrationHealth(base(2));
    const again = await getIntegrationHealth(later(base(2), HEALTH_TTL_MS));

    expect(again.generatedAt).toBe("2026-10-02T02:00:10.000Z");
    expect(reads()).toBe(2);
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it("dois pedidos no mesmo instante: uma leitura só", async () => {
    const first = await getIntegrationHealth(base(3));
    const second = await getIntegrationHealth(base(3));

    expect(second).toBe(first);
    expect(reads()).toBe(1);
  });

  it("pedido que chega com a leitura em curso recebe a mesma: o provedor é chamado uma vez", async () => {
    const provider = holdProvider();

    const first = getIntegrationHealth(base(4));
    await untilProviderCalled(1);
    // A leitura está parada no provedor: quem chega agora não começa outra.
    const others = [getIntegrationHealth(later(base(4), 5)), getIntegrationHealth(later(base(4), 9_000))];
    provider.release();
    const results = await Promise.all([first, ...others]);

    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(reads()).toBe(1);
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it("o prazo conta do começo da leitura: se ela ainda está em curso quando ele vence, o pedido seguinte começa outra", async () => {
    const provider = holdProvider();

    const slow = getIntegrationHealth(base(5));
    await untilProviderCalled(1);
    const next = getIntegrationHealth(later(base(5), HEALTH_TTL_MS));
    await untilProviderCalled(2);
    provider.release();
    const [first, second] = await Promise.all([slow, next]);

    expect(reads()).toBe(2);
    expect(first.generatedAt).toBe("2026-10-02T05:00:00.000Z");
    expect(second.generatedAt).toBe("2026-10-02T05:00:10.000Z");
  });

  it("relógio que anda para trás não devolve leitura do futuro: lê de novo", async () => {
    await getIntegrationHealth(base(7));
    const earlier = await getIntegrationHealth(base(6));

    expect(earlier.generatedAt).toBe("2026-10-02T06:00:00.000Z");
    expect(reads()).toBe(2);
  });

  it("sem `now` informado, o prazo conta do relógio", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(base(8));

    const first = await getIntegrationHealth();
    vi.setSystemTime(later(base(8), 9_999));
    const second = await getIntegrationHealth();
    vi.setSystemTime(later(base(8), 10_000));
    const third = await getIntegrationHealth();

    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(third.generatedAt).toBe("2026-10-02T08:00:10.000Z");
  });
});
