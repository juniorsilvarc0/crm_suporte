// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock, hasEnvMock } = vi.hoisted(() => ({ clientMock: vi.fn(), hasEnvMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: clientMock,
  hasSupabaseAdminEnv: hasEnvMock,
}));

import { createHarness, has, type Call } from "@/app/api/v1/test-harness";
import { DEFAULT_INTEGRATION_LOG_FILTERS } from "@/features/integrations/lib/log-filters";
import {
  getIntegrationLogs,
  INTEGRATION_LOGS_PAGE_SIZE,
} from "@/features/integrations/queries/get-integration-logs";
import { decodeLogCursor, encodeLogCursor, encodeMessageCursor } from "@/lib/api/v1/cursor";

const h = createHarness(clientMock);

const NOW = new Date("2026-10-01T12:00:00.000Z");
const TOKEN_ID = "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90";
const USER_ID = "3d9a7c2e-1b4f-4a6d-8e2c-5f7a9b1c3d4e";
const OTHER_USER_ID = "7e1c5a3b-9d2f-4b8a-a6c4-1e3f5d7b9a2c";
const NONE = DEFAULT_INTEGRATION_LOG_FILTERS;

/** Uma linha como o PostgREST a devolve para o select da lista. */
function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    created_at: `2026-10-01T11:${String(59 - (n % 60)).padStart(2, "0")}:00.123456+00:00`,
    provider: "api_v1",
    direction: "inbound",
    action: "GET",
    status: "ok",
    http_status: 200,
    latency_ms: 12,
    route: "/api/v1/tickets",
    request_id: `pedido-${n}`,
    error: null,
    actor_id: null,
    token: { id: TOKEN_ID, name: "IA de triagem", token_prefix: "crmsuporte_ab" },
    ...extra,
  };
}

const logsChain = (): Call[] => h.lastChain("integration_logs");
/** Os filtros da cadeia, na ordem, sem o select, a ordem e o limite. */
const conditions = (chain: Call[]) =>
  chain.filter(([method]) => !["select", "order", "limit"].includes(method));

beforeEach(() => {
  vi.clearAllMocks();
  h.reset([]);
  hasEnvMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getIntegrationLogs", () => {
  it("sem filtro: os últimos 7 dias, do mais novo para o mais antigo, uma linha a mais que a página", async () => {
    h.tables.integration_logs = () => ({ data: [], error: null });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page).toEqual({ state: "ok", items: [], nextCursor: null });
    const chain = logsChain();
    // Sem filtro pedido, a única condição é a do período.
    expect(conditions(chain)).toEqual([["gte", "created_at", "2026-09-24T12:00:00.000Z"]]);
    expect(has(chain, "limit", INTEGRATION_LOGS_PAGE_SIZE + 1)).toBe(true);
    // A ordem do desempate é a do cursor: primeiro o instante, depois o id, os dois decrescentes.
    expect(chain.filter(([method]) => method === "order")).toEqual([
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });

  it("a página tem 50 registros", () => {
    expect(INTEGRATION_LOGS_PAGE_SIZE).toBe(50);
  });

  it("o select não traz o payload nem o hash do token: só quem fez a ação, extraído no banco", async () => {
    await getIntegrationLogs(NONE, null, NOW);

    const select = String(logsChain().find(([method]) => method === "select")?.[1]);
    expect(select).toContain("actor_id:payload->>by");
    expect(select.split(",").map((column) => column.trim())).not.toContain("payload");
    expect(select).toContain("token:api_tokens!integration_logs_api_token_id_fkey(id, name, token_prefix)");
    expect(select).not.toContain("token_hash");
    expect(select).not.toContain("*");
  });

  it.each([
    ["24h", "2026-09-30T12:00:00.000Z"],
    ["7d", "2026-09-24T12:00:00.000Z"],
    ["30d", "2026-09-01T12:00:00.000Z"],
    ["90d", "2026-07-03T12:00:00.000Z"],
  ] as const)("período %s: desde %s", async (periodo, since) => {
    await getIntegrationLogs({ ...NONE, periodo }, null, NOW);

    expect(has(logsChain(), "gte", "created_at", since)).toBe(true);
  });

  it("cada filtro vira uma condição no banco", async () => {
    await getIntegrationLogs(
      { ...NONE, integracao: "relay", status: "error", acao: "webhook.ping", token: TOKEN_ID },
      null,
      NOW
    );

    expect(conditions(logsChain())).toEqual([
      ["gte", "created_at", "2026-09-24T12:00:00.000Z"],
      ["eq", "provider", "relay"],
      ["eq", "status", "error"],
      ["eq", "action", "webhook.ping"],
      ["eq", "api_token_id", TOKEN_ID],
    ]);
  });

  it("busca por id de pedido ignora o período, e os outros filtros seguem valendo", async () => {
    await getIntegrationLogs(
      { integracao: "api_v1", status: "error", acao: "POST", token: TOKEN_ID, pedido: "pedido-7", periodo: "24h" },
      null,
      NOW
    );

    expect(conditions(logsChain())).toEqual([
      ["eq", "request_id", "pedido-7"],
      ["eq", "provider", "api_v1"],
      ["eq", "status", "error"],
      ["eq", "action", "POST"],
      ["eq", "api_token_id", TOKEN_ID],
    ]);
  });

  it("segunda página com filtros: o cursor se soma a TODOS os filtros da primeira", async () => {
    const last = row(3);

    await getIntegrationLogs(
      { ...NONE, integracao: "relay", status: "error", acao: "conversation.message_received", token: TOKEN_ID, periodo: "30d" },
      encodeLogCursor(last),
      NOW
    );

    expect(conditions(logsChain())).toEqual([
      ["gte", "created_at", "2026-09-01T12:00:00.000Z"],
      ["eq", "provider", "relay"],
      ["eq", "status", "error"],
      ["eq", "action", "conversation.message_received"],
      ["eq", "api_token_id", TOKEN_ID],
      // O limite que o índice usa, e o corte exato do desempate.
      ["lte", "created_at", last.created_at],
      ["or", `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`],
    ]);
  });

  it("segunda página da busca por id de pedido: o cursor vale, e o período continua de fora", async () => {
    const last = row(3);

    await getIntegrationLogs({ ...NONE, pedido: "pedido-7" }, encodeLogCursor(last), NOW);

    expect(conditions(logsChain())).toEqual([
      ["eq", "request_id", "pedido-7"],
      ["lte", "created_at", last.created_at],
      ["or", `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`],
    ]);
  });

  it.each([
    ["texto qualquer", "lixo"],
    ["o cursor de outra lista (mensagens)", encodeMessageCursor({ created_at: row(1).created_at, id: row(1).id })],
    ["tentativa de mexer no filtro", "created_at.gt.2020,id.neq.x"],
    ["vazio", ""],
    ["longo demais", "c".repeat(500)],
  ])("cursor que não saiu desta lista (%s): `invalid_cursor`, sem consultar o banco", async (_label, cursor) => {
    const page = await getIntegrationLogs(NONE, cursor, NOW);

    expect(page).toEqual({ state: "invalid_cursor" });
    expect(h.chains.integration_logs).toBeUndefined();
  });

  it("página cheia: devolve o tamanho da página e o cursor da última linha DEVOLVIDA", async () => {
    const rows = Array.from({ length: INTEGRATION_LOGS_PAGE_SIZE + 1 }, (_, index) => row(index + 1));
    h.tables.integration_logs = () => ({ data: rows, error: null });

    const page = await getIntegrationLogs(NONE, null, NOW);

    if (page.state !== "ok") throw new Error("a página deveria ter sido lida");
    expect(page.items).toHaveLength(INTEGRATION_LOGS_PAGE_SIZE);
    expect(page.items.at(-1)?.id).toBe(rows[INTEGRATION_LOGS_PAGE_SIZE - 1].id);
    expect(decodeLogCursor(page.nextCursor ?? "")).toEqual({
      createdAt: rows[INTEGRATION_LOGS_PAGE_SIZE - 1].created_at,
      id: rows[INTEGRATION_LOGS_PAGE_SIZE - 1].id,
    });
  });

  it("página do tamanho exato, sem linha a mais: não há próxima", async () => {
    h.tables.integration_logs = () => ({
      data: Array.from({ length: INTEGRATION_LOGS_PAGE_SIZE }, (_, index) => row(index + 1)),
      error: null,
    });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page).toMatchObject({ state: "ok", nextCursor: null });
    expect(page.state === "ok" && page.items).toHaveLength(INTEGRATION_LOGS_PAGE_SIZE);
  });

  it("monta o item campo a campo: token com nome e prefixo, e nada além das chaves da lista", async () => {
    h.tables.integration_logs = () => ({
      data: [{ ...row(1), payload: { by: USER_ID, segredo: "x" }, api_token_id: TOKEN_ID }],
      error: null,
    });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page.state === "ok" && page.items).toEqual([
      {
        id: row(1).id,
        created_at: row(1).created_at,
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
      },
    ]);
  });

  it("o motivo do erro vai inteiro para a tela", async () => {
    h.tables.integration_logs = () => ({
      data: [
        row(1, {
          provider: "relay",
          direction: "outbound",
          action: "conversation.message_received",
          status: "error",
          http_status: 500,
          error: "O agente respondeu HTTP 500.",
          token: null,
        }),
      ],
      error: null,
    });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page.state === "ok" && page.items[0]).toMatchObject({
      status: "error",
      http_status: 500,
      error: "O agente respondeu HTTP 500.",
    });
  });

  it("trilha da chave de assinatura: diz quem fez, com o nome lido uma vez por usuário", async () => {
    h.tables.integration_logs = () => ({
      data: [
        row(1, { provider: "relay", direction: null, action: "signing_secret.rotated", token: null, actor_id: USER_ID }),
        row(2, { provider: "relay", direction: null, action: "signing_secret.generated", token: null, actor_id: USER_ID }),
        row(3, { provider: "relay", direction: null, action: "signing_secret.removed", token: null, actor_id: OTHER_USER_ID }),
      ],
      error: null,
    });
    h.tables.app_users = () => ({ data: [{ id: USER_ID, name: "Ana" }], error: null });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page.state === "ok" && page.items.map((item) => item.actor)).toEqual([
      { id: USER_ID, name: "Ana" },
      { id: USER_ID, name: "Ana" },
      // Usuário que não existe mais: o id fica, o nome não.
      { id: OTHER_USER_ID, name: null },
    ]);
    expect(h.chains.app_users).toHaveLength(1);
    expect(has(h.lastChain("app_users"), "select", "id, name")).toBe(true);
    expect(has(h.lastChain("app_users"), "in", "id", [USER_ID, OTHER_USER_ID])).toBe(true);
  });

  it("`payload.by` que não é uuid não vira usuário, e sem usuário na página os nomes nem são lidos", async () => {
    h.tables.integration_logs = () => ({
      data: [row(1, { actor_id: "admin" }), row(2, { actor_id: "" }), row(3)],
      error: null,
    });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page.state === "ok" && page.items.map((item) => item.actor)).toEqual([null, null, null]);
    expect(h.chains.app_users).toBeUndefined();
  });

  it.each([
    ["devolve erro", () => ({ data: null, error: { message: "permission denied", code: "42501" } })],
    [
      "lança",
      () => {
        throw new Error("socket hang up");
      },
    ],
  ])("a leitura dos nomes %s: a página sai mesmo assim, com o id de quem fez", async (_label, respond) => {
    h.tables.integration_logs = () => ({ data: [row(1, { actor_id: USER_ID })], error: null });
    h.tables.app_users = respond;

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page.state === "ok" && page.items[0].actor).toEqual({ id: USER_ID, name: null });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("direção e status que o app não conhece viram nulo, em vez de irem crus para a tela", async () => {
    h.tables.integration_logs = () => ({
      data: [row(1, { direction: "sideways", status: "pending", token: null })],
      error: null,
    });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page.state === "ok" && page.items[0]).toMatchObject({ direction: null, status: null, token: null });
  });

  it("o banco falha: `unavailable`, e não uma lista vazia; o log leva o código e a mensagem", async () => {
    h.tables.integration_logs = () => ({ data: null, error: { message: "relation does not exist", code: "42P01" } });

    const page = await getIntegrationLogs(NONE, null, NOW);

    expect(page).toEqual({ state: "unavailable" });
    expect(console.error).toHaveBeenCalledWith("getIntegrationLogs failed", "42P01", "relation does not exist");
  });

  it("falha de rede, que o cliente devolve com o código VAZIO: a mensagem não se perde", async () => {
    h.tables.integration_logs = () => ({ data: null, error: { message: "TypeError: fetch failed", code: "" } });

    expect(await getIntegrationLogs(NONE, null, NOW)).toEqual({ state: "unavailable" });
    expect(console.error).toHaveBeenCalledWith("getIntegrationLogs failed", "", "TypeError: fetch failed");
  });

  it("o cliente lança em vez de devolver erro: `unavailable`, sem rejeitar", async () => {
    h.tables.integration_logs = () => {
      throw new Error("socket hang up");
    };

    expect(await getIntegrationLogs(NONE, null, NOW)).toEqual({ state: "unavailable" });
    expect(console.error).toHaveBeenCalledWith("getIntegrationLogs failed", "socket hang up");
  });

  it("criar o cliente lança: `unavailable`, sem rejeitar", async () => {
    clientMock.mockImplementation(() => {
      throw new Error("SUPABASE_URL inválida");
    });

    expect(await getIntegrationLogs(NONE, null, NOW)).toEqual({ state: "unavailable" });
  });

  it("sem o Supabase configurado: `unavailable`, sem criar o cliente", async () => {
    hasEnvMock.mockReturnValue(false);
    clientMock.mockClear();

    expect(await getIntegrationLogs(NONE, null, NOW)).toEqual({ state: "unavailable" });
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("sem cursor e sem `now` informados: primeira página, com a janela contada de agora", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    await getIntegrationLogs({ ...NONE, periodo: "24h" });

    expect(conditions(logsChain())).toEqual([["gte", "created_at", "2026-09-30T12:00:00.000Z"]]);
  });
});
