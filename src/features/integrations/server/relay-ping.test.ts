// @vitest-environment node
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { secretMock } = vi.hoisted(() => ({ secretMock: vi.fn() }));
// O cofre é de mentira; a classe do erro é a de verdade.
vi.mock("@/features/settings/lib/get-runtime-environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/settings/lib/get-runtime-environment")>()),
  readRuntimeEnvironmentVariable: secretMock,
}));

import { createHarness, where, type Call } from "@/app/api/v1/test-harness";
import { PING_ONLY_KEYS, relayFieldsSchema } from "@/features/integrations/server/relay-envelope";
import { PING_EVENT, pingAgent, pingBody } from "@/features/integrations/server/relay-ping";
import { RuntimeEnvironmentUnavailableError } from "@/features/settings/lib/get-runtime-environment";

// O teste de conexão de ponta a ponta, sem rede: a URL vem do Supabase falso de
// test-harness.ts, o `fetch` é de mentira, e a assinatura é conferida por uma
// conta feita AQUI (node:crypto), não pela função do app.

const NOW = new Date("2026-10-01T12:00:00.700Z");
const NOW_SECONDS = "1790856000";
const RELAY_URL = "https://agente.exemplo.com/webhook/7f3c?fluxo=suporte";
const SECRET = "9f2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e0b2d4f6a8c0e1b3d5f7a9c1e3b5d7f90";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const adminClientMock = vi.fn();
const h = createHarness(adminClientMock);
let supabase: Parameters<typeof pingAgent>[0];
let fetchMock: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.spyOn>;
let consoles: ReturnType<typeof vi.spyOn>[];
/** Tudo o que foi para o console do servidor, em qualquer nível. */
const consoleOutput = () => JSON.stringify(consoles.flatMap((spy) => spy.mock.calls));

/** O `fetch` de mentira: `elapsedMs` é quanto o agente "demora". */
function agent(respond: () => unknown, elapsedMs = 0) {
  fetchMock.mockImplementation(async () => {
    vi.advanceTimersByTime(elapsedMs);
    return respond();
  });
}

const sentInit = (call = 0) => fetchMock.mock.calls[call][1] as RequestInit & { headers: Record<string, string> };
const sentBody = (call = 0) => String(sentInit(call).body);

/** As linhas gravadas em integration_logs. */
const logged = () =>
  (h.chains.integration_logs ?? []).map((calls: Call[]) => calls.find(([method]) => method === "insert")?.[1]);

beforeEach(() => {
  vi.clearAllMocks();
  // Só os relógios (o do instante e o de duração): as promessas seguem de verdade.
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  h.reset([]);
  h.tables.app_settings = () => ({ data: { value: { relay_url: RELAY_URL } }, error: null });
  supabase = adminClientMock();
  secretMock.mockResolvedValue(SECRET);
  fetchMock = vi.fn();
  agent(() => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined)
  );
  error = consoles[3];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const spy of consoles) spy.mockRestore();
});

describe("pingBody", () => {
  it("leva o tipo e o id do evento, a versão do contrato e o instante, nessa ordem", () => {
    expect(pingBody("2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", NOW)).toBe(
      '{"event":"webhook.ping","event_id":"2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e","relay_version":1,"sent_at":"2026-10-01T12:00:00.700Z"}'
    );
  });

  it("toda chave do corpo é reservada no envelope da mensagem: o provedor não consegue imitá-la", () => {
    const keys = Object.keys(JSON.parse(pingBody("x", NOW)));

    // `relay_version` é campo do CRM (já reservado); as outras, só do teste.
    expect(keys.filter((key) => key !== "relay_version")).toEqual([...PING_ONLY_KEYS]);
    expect(Object.keys(relayFieldsSchema.shape)).toContain("relay_version");
  });

  it("sem instante informado, usa o de agora", () => {
    expect(JSON.parse(pingBody("x")).sent_at).toBe(NOW.toISOString());
  });
});

describe("pingAgent: o que sai", () => {
  it("POST único na URL SALVA, sem seguir redirecionamento e com prazo", async () => {
    await pingAgent(supabase);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // O destino é o objeto que PASSOU pela guarda, não o texto lido do banco.
    expect(fetchMock.mock.calls[0][0]).toBeInstanceOf(URL);
    expect(String(fetchMock.mock.calls[0][0])).toBe(RELAY_URL);
    expect(sentInit()).toMatchObject({ method: "POST", redirect: "manual" });
    // Nenhuma opção a mais vai no pedido (credenciais, cache, seguir redirecionamento).
    expect(Object.keys(sentInit()).sort()).toEqual(["body", "headers", "method", "redirect", "signal"]);
    expect(where(h.chains.app_settings[0], "key", "automation")).toBe(true);
  });

  it("o prazo do teste é o do repasse: 10 s, contados só depois das leituras do CRM", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await pingAgent(supabase);

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(sentInit().signal).toBe(timeout.mock.results[0].value);
    expect(timeout.mock.invocationCallOrder[0]).toBeGreaterThan(secretMock.mock.invocationCallOrder[0]);
    timeout.mockRestore();
  });

  it("os cabeçalhos são os do contrato, com o evento webhook.ping e a assinatura que confere por conta independente", async () => {
    await pingAgent(supabase);

    const body = sentBody();
    const { event_id: eventId } = JSON.parse(body);
    expect(eventId).toMatch(UUID);
    const expected = createHmac("sha256", SECRET).update(`${NOW_SECONDS}.${body}`, "utf8").digest("hex");
    expect(sentInit().headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "crm-suporte-relay/1",
      "X-CRM-Event": "webhook.ping",
      "X-CRM-Event-Id": eventId,
      "X-CRM-Timestamp": NOW_SECONDS,
      "X-CRM-Signature": `v1=${expected}`,
    });
    expect(PING_EVENT).toBe("webhook.ping");
  });

  it("o corpo é só o do ping: nenhum dado de cliente, de conversa ou de ticket", async () => {
    await pingAgent(supabase);

    const body = JSON.parse(sentBody());
    expect(body).toEqual({
      event: "webhook.ping",
      event_id: expect.stringMatching(UUID),
      relay_version: 1,
      sent_at: NOW.toISOString(),
    });
    expect(Object.keys(body)).toEqual(["event", "event_id", "relay_version", "sent_at"]);
    // Nada além da URL foi lido, e nada além do registro foi gravado.
    expect(Object.keys(h.chains).sort()).toEqual(["app_settings", "integration_logs"]);
    expect(h.rpcCalls).toEqual([]);
  });

  it("a chave é lida do cofre pelo nome dela, a cada teste (sem cache)", async () => {
    await pingAgent(supabase);
    await pingAgent(supabase);

    expect(secretMock.mock.calls).toEqual([["RELAY_SIGNING_SECRET"], ["RELAY_SIGNING_SECRET"]]);
  });

  it("sem chave no cofre: sai sem X-CRM-Signature, e o resultado diz que foi sem assinatura", async () => {
    secretMock.mockResolvedValue(null);

    const result = await pingAgent(supabase);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(sentInit().headers)).toEqual([
      "Content-Type",
      "User-Agent",
      "X-CRM-Event",
      "X-CRM-Event-Id",
      "X-CRM-Timestamp",
    ]);
    expect(result).toEqual({
      sent: true,
      host: "agente.exemplo.com",
      delivered: true,
      error: null,
      httpStatus: 200,
      latencyMs: 0,
      signed: false,
    });
  });

  it("chave vazia no cofre é `sem chave`: sai sem assinatura, e o resultado diz o mesmo que o pedido", async () => {
    // O leitor de verdade devolve null para valor vazio; aqui o critério do
    // resultado e o do cabeçalho são conferidos um contra o outro.
    secretMock.mockResolvedValue("");

    const result = await pingAgent(supabase);

    expect(sentInit().headers).not.toHaveProperty("X-CRM-Signature");
    expect(result).toMatchObject({ sent: true, delivered: true, signed: false });
  });

  it("cada teste é um evento novo: o id não se repete", async () => {
    await pingAgent(supabase);
    await pingAgent(supabase);

    const first = JSON.parse(sentBody(0)).event_id;
    const second = JSON.parse(sentBody(1)).event_id;
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
    expect(sentInit(1).headers["X-CRM-Event-Id"]).toBe(second);
  });
});

describe("pingAgent: o desfecho", () => {
  it("agente responde 2xx: entregue, com o status, o tempo e a assinatura", async () => {
    agent(() => new Response(null, { status: 204 }), 137);

    const result = await pingAgent(supabase);

    expect(result).toEqual({
      sent: true,
      host: "agente.exemplo.com",
      delivered: true,
      error: null,
      httpStatus: 204,
      latencyMs: 137,
      signed: true,
    });
  });

  it("o resultado diz para ONDE foi: só o host (com a porta), nunca o caminho nem a query", async () => {
    h.tables.app_settings = () => ({
      data: { value: { relay_url: "https://n8n.exemplo.com:8443/webhook/caminho-secreto?token=abc" } },
      error: null,
    });

    const result = await pingAgent(supabase);

    expect(result).toMatchObject({ sent: true, host: "n8n.exemplo.com:8443" });
    expect(JSON.stringify(result)).not.toContain("caminho-secreto");
    expect(JSON.stringify(result)).not.toContain("abc");
  });

  it("o tempo é só o do agente: ler a URL e o cofre antes do envio não conta", async () => {
    const normal = h.tables.app_settings;
    h.tables.app_settings = (calls) => {
      vi.advanceTimersByTime(4_000);
      return normal(calls);
    };
    secretMock.mockImplementation(async () => {
      vi.advanceTimersByTime(3_000);
      return SECRET;
    });
    agent(() => new Response(null, { status: 200 }), 250);

    const result = await pingAgent(supabase);

    expect(result).toMatchObject({ delivered: true, latencyMs: 250 });
    expect(logged()[0]).toMatchObject({ latency_ms: 250 });
    // O instante assinado é o do envio, depois das leituras.
    expect(sentInit().headers["X-CRM-Timestamp"]).toBe(String(Number(NOW_SECONDS) + 7));
  });

  it.each([
    [401, "O agente respondeu HTTP 401."],
    [500, "O agente respondeu HTTP 500."],
    // Redirecionamento não é seguido: conta como falha, e nada sai para o novo endereço.
    [302, "O agente respondeu HTTP 302."],
  ])("agente responde %i: saiu, mas não foi confirmado, e o motivo traz o status", async (status, message) => {
    agent(() => new Response(null, { status, headers: status === 302 ? { Location: "https://outro.exemplo.com/" } : {} }), 42);

    const result = await pingAgent(supabase);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sent: true,
      host: "agente.exemplo.com",
      delivered: false,
      error: message,
      httpStatus: status,
      latencyMs: 42,
      signed: true,
    });
  });

  it("agente não responde no prazo: saiu, sem status, e o motivo diz o prazo", async () => {
    agent(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }, 10_000);

    const result = await pingAgent(supabase);

    expect(result).toEqual({
      sent: true,
      host: "agente.exemplo.com",
      delivered: false,
      error: "O agente não respondeu em 10 s.",
      httpStatus: null,
      latencyMs: 10_000,
      signed: true,
    });
    // Sem nova tentativa: um pedido e um registro (o agente pode ter recebido).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logged()).toHaveLength(1);
  });

  it.each([
    ["com código", new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }), "Falha de rede (ENOTFOUND)."],
    ["sem código", new TypeError("fetch failed"), "Falha de rede."],
  ])("falha de rede %s: o motivo não leva a URL nem a mensagem crua do erro", async (_label, failure, message) => {
    agent(() => {
      throw failure;
    }, 9);

    const result = await pingAgent(supabase);

    expect(result).toEqual({
      sent: true,
      host: "agente.exemplo.com",
      delivered: false,
      error: message,
      httpStatus: null,
      latencyMs: 9,
      signed: true,
    });
    expect(result.sent && result.error).not.toContain("agente.exemplo.com");
    expect(result.sent && result.error).not.toContain("fetch failed");
    // Sem nova tentativa: um pedido e um registro.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logged()).toHaveLength(1);
  });
});

describe("pingAgent: o registro", () => {
  it("o teste que saiu fica em integration_logs, com o id do evento, o status e o tempo, e sem corpo nem URL", async () => {
    agent(() => new Response(null, { status: 200 }), 88);

    await pingAgent(supabase);

    const eventId = JSON.parse(sentBody()).event_id;
    expect(logged()).toEqual([
      {
        provider: "relay",
        direction: "outbound",
        action: "webhook.ping",
        status: "ok",
        payload: undefined,
        error: undefined,
        api_token_id: null,
        request_id: eventId,
        route: undefined,
        http_status: 200,
        latency_ms: 88,
      },
    ]);
    expect(JSON.stringify(logged())).not.toContain("agente.exemplo.com");
    expect(JSON.stringify(logged())).not.toContain(SECRET);
  });

  it("o teste que falhou fica registrado como erro, com o motivo", async () => {
    agent(() => new Response(null, { status: 403 }), 12);

    await pingAgent(supabase);

    expect(logged()).toEqual([
      {
        provider: "relay",
        direction: "outbound",
        action: "webhook.ping",
        status: "error",
        payload: undefined,
        error: "O agente respondeu HTTP 403.",
        api_token_id: null,
        request_id: JSON.parse(sentBody()).event_id,
        route: undefined,
        http_status: 403,
        latency_ms: 12,
      },
    ]);
  });

  it("o resultado só volta depois de o registro ser gravado (a rota não responde com o registro pendente)", async () => {
    // Uma gravação que só termina quando o teste manda: com um banco de mentira
    // que responde na hora, esperar ou não o registro daria no mesmo.
    let finishInsert: ((value: { data: null; error: null }) => void) | undefined;
    h.tables.integration_logs = () =>
      new Promise((resolve) => {
        finishInsert = resolve;
      }) as never;
    let settled = false;

    const done = pingAgent(supabase).then((result) => {
      settled = true;
      return result;
    });
    // Deixa o teste andar até a gravação do registro começar.
    for (let turn = 0; turn < 50 && !finishInsert; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(finishInsert).toBeDefined();
    expect(settled).toBe(false);

    finishInsert?.({ data: null, error: null });

    expect(await done).toMatchObject({ sent: true, delivered: true });
    expect(settled).toBe(true);
  });

  it("falha ao gravar o registro não muda o desfecho do teste", async () => {
    h.tables.integration_logs = () => ({ data: null, error: { message: "disco cheio" } });

    const result = await pingAgent(supabase);

    expect(result).toMatchObject({ sent: true, delivered: true, httpStatus: 200 });
  });

  it("o registro que LANÇA também não: o pedido já saiu, e quem testa recebe o desfecho", async () => {
    h.tables.integration_logs = () => {
      throw new Error("conexão com o banco caiu");
    };
    agent(() => new Response(null, { status: 401 }), 15);

    const result = await pingAgent(supabase);

    expect(result).toMatchObject({ sent: true, delivered: false, httpStatus: 401, latencyMs: 15 });
    expect(error).toHaveBeenCalledWith("[relay] registrar o teste de conexão falhou:", expect.any(Error));
  });
});

describe("pingAgent: o console do servidor", () => {
  it.each([
    ["o agente confirma", () => new Response(null, { status: 200 })],
    ["o agente recusa", () => new Response(null, { status: 401 })],
    [
      "a rede falha",
      () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
    ],
  ])("quando %s: nem a URL do agente nem a chave vão para o console", async (_label, respond) => {
    agent(respond);

    await pingAgent(supabase);

    const output = consoleOutput();
    expect(output).not.toContain("agente.exemplo.com");
    expect(output).not.toContain("7f3c");
    expect(output).not.toContain(SECRET);
  });

  it("um teste que dá certo não escreve nada no console", async () => {
    await pingAgent(supabase);

    expect(consoleOutput()).toBe("[]");
  });
});

describe("pingAgent: quando nada sai", () => {
  /** Nada foi à rede e nada foi para o registro: o administrador vê o motivo na tela. */
  const nothingLeft = () => {
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.chains.integration_logs).toBeUndefined();
  };

  it.each([
    ["sem linha de configuração", null],
    ["com a URL vazia", { value: { relay_url: "  " } }],
    ["com o valor fora do formato", { value: "https://agente.exemplo.com" }],
  ])("sem URL salva (%s): diz que não há agente, sem nem ler o cofre", async (_label, row) => {
    h.tables.app_settings = () => ({ data: row, error: null });

    const result = await pingAgent(supabase);

    expect(result).toEqual({ sent: false, error: "Nenhuma URL de agente configurada." });
    expect(secretMock).not.toHaveBeenCalled();
    nothingLeft();
  });

  it("a leitura da URL falha: não diz `sem URL`", async () => {
    h.tables.app_settings = () => ({ data: null, error: { message: "timeout" } });

    const result = await pingAgent(supabase);

    expect(result).toEqual({ sent: false, error: "Não foi possível ler a URL do agente." });
    expect(error).toHaveBeenCalledWith("[relay] ler a URL do agente falhou:", expect.any(Error));
    expect(secretMock).not.toHaveBeenCalled();
    nothingLeft();
  });

  it.each([
    ["rede interna", "http://10.0.0.5/hook", "A URL aponta para um host de rede interna (bloqueado)."],
    ["metadados da nuvem", "http://169.254.169.254/latest", "A URL aponta para um host de rede interna (bloqueado)."],
    ["usuário e senha", "https://usuario:senha@agente.exemplo.com/hook", "A URL não pode levar usuário e senha."],
    ["outro protocolo", "ftp://agente.exemplo.com/hook", "A URL deve usar http ou https."],
    ["texto que não é URL", "agente", "URL inválida."],
  ])("URL salva que a guarda recusa (%s): nada sai, e o motivo é o da guarda", async (_label, url, reason) => {
    h.tables.app_settings = () => ({ data: { value: { relay_url: url } }, error: null });

    const result = await pingAgent(supabase);

    expect(result).toEqual({ sent: false, error: `URL do agente recusada: ${reason}` });
    expect(secretMock).not.toHaveBeenCalled();
    nothingLeft();
  });

  it("em produção, URL http é recusada: o teste usa a MESMA guarda do repasse", async () => {
    vi.stubEnv("NODE_ENV", "production");
    h.tables.app_settings = () => ({ data: { value: { relay_url: "http://agente.exemplo.com/hook" } }, error: null });

    const result = await pingAgent(supabase);

    expect(result).toEqual({
      sent: false,
      error: "URL do agente recusada: Em produção a URL deve usar HTTPS.",
    });
    nothingLeft();
  });

  it("cofre ilegível: o teste NÃO sai sem assinatura por engano", async () => {
    secretMock.mockRejectedValue(new RuntimeEnvironmentUnavailableError("timeout"));

    const result = await pingAgent(supabase);

    expect(result).toEqual({
      sent: false,
      error: "Cofre indisponível: não foi possível ler a chave de assinatura.",
    });
    expect(error).toHaveBeenCalledWith("[relay] ler a chave de assinatura falhou:", expect.any(Error));
    nothingLeft();
  });
});
