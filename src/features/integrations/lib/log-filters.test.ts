// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTEGRATION_LOG_FILTERS,
  integrationLogSearch,
  isIntegrationStatus,
  parseIntegrationLogFilters,
} from "@/features/integrations/lib/log-filters";
import { RELAY_EVENT } from "@/features/integrations/server/relay-message";
import { PING_EVENT } from "@/features/integrations/server/relay-ping";
import {
  INTEGRATION_LOG_ACTIONS,
  INTEGRATION_LOG_PERIODS,
  INTEGRATION_LOG_PROVIDERS,
  type IntegrationLogFilters,
} from "@/features/integrations/types";

const TOKEN_ID = "0b8f2c1e-6a4d-4f2b-9c1a-7d3e5f6a8b90";
const NONE = DEFAULT_INTEGRATION_LOG_FILTERS;

describe("parseIntegrationLogFilters", () => {
  it("sem nada na URL: os últimos 7 dias, sem filtro", () => {
    expect(parseIntegrationLogFilters({})).toEqual({
      integracao: null,
      status: null,
      acao: null,
      token: null,
      pedido: null,
      periodo: "7d",
    });
  });

  it("lê cada filtro da URL, e a chave do filtro é o nome do parâmetro", () => {
    expect(
      parseIntegrationLogFilters({
        integracao: "relay",
        status: "error",
        acao: "webhook.ping",
        token: TOKEN_ID.toUpperCase(),
        pedido: " pedido-7 ",
        periodo: "30d",
      })
    ).toEqual({
      integracao: "relay",
      status: "error",
      acao: "webhook.ping",
      token: TOKEN_ID,
      pedido: "pedido-7",
      periodo: "30d",
    });
  });

  it.each([
    ["integração que não grava registro", { integracao: "uazapi" }],
    ["status desconhecido", { status: "pending" }],
    ["período fora da lista", { periodo: "1y" }],
    ["token que não é uuid", { token: "tok-1" }],
    ["ação que ninguém grava", { acao: "signing_secret.stolen" }],
    ["ação conhecida em outra caixa", { acao: "get" }],
    ["id de pedido em branco", { pedido: "   " }],
    ["id de pedido maior que a coluna", { pedido: "p".repeat(129) }],
    ["id de pedido com NUL, que o Postgres recusa", { pedido: "a\u0000b" }],
    ["id de pedido com quebra de linha", { pedido: "a\nb" }],
    ["id de pedido com vírgula e parêntese", { pedido: "a,b)" }],
    ["id de pedido com espaço no meio", { pedido: "a b" }],
  ])("ignora %s: o link antigo não vira erro", (_label, params) => {
    expect(parseIntegrationLogFilters(params)).toEqual(NONE);
  });

  it("aceita o id de pedido no tamanho exato da coluna, e os formatos de id que o app grava", () => {
    expect(parseIntegrationLogFilters({ pedido: "p".repeat(128) }).pedido).toHaveLength(128);
    for (const pedido of [TOKEN_ID, "3EB0A1B2C3D4", "5511999990000@s.whatsapp.net:3EB0", "req_1.2-3"]) {
      expect(parseIntegrationLogFilters({ pedido }).pedido).toBe(pedido);
    }
  });

  it("parâmetro repetido na URL da página: vale o primeiro", () => {
    expect(parseIntegrationLogFilters({ integracao: ["api_v1", "relay"], periodo: ["24h", "90d"] })).toMatchObject({
      integracao: "api_v1",
      periodo: "24h",
    });
  });

  it("não lê o cursor: ele não é filtro", () => {
    expect(parseIntegrationLogFilters({ cursor: "abc" })).toEqual(NONE);
    expect(Object.keys(parseIntegrationLogFilters({ cursor: "abc" }))).not.toContain("cursor");
  });

  it.each(INTEGRATION_LOG_PROVIDERS)("aceita toda ação de %s", (provider) => {
    for (const acao of INTEGRATION_LOG_ACTIONS[provider]) {
      expect(parseIntegrationLogFilters({ acao }).acao).toBe(acao);
    }
  });

  it.each(INTEGRATION_LOG_PERIODS)("aceita o período %s", (periodo) => {
    expect(parseIntegrationLogFilters({ periodo }).periodo).toBe(periodo);
  });
});

describe("integrationLogSearch", () => {
  it("padrão fica fora da URL: link limpo", () => {
    expect(integrationLogSearch(NONE)).toEqual({});
  });

  it("escreve só o que foge do padrão", () => {
    expect(integrationLogSearch({ ...NONE, status: "error", periodo: "24h" })).toEqual({ status: "error", periodo: "24h" });
  });

  it("o que a tela escreve é o que o servidor lê, para qualquer combinação", () => {
    const samples: IntegrationLogFilters[] = [
      NONE,
      { integracao: "relay", status: "error", acao: "conversation.message_received", token: null, pedido: null, periodo: "24h" },
      { integracao: "api_v1", status: "ok", acao: "POST", token: TOKEN_ID, pedido: null, periodo: "90d" },
      { integracao: null, status: null, acao: null, token: null, pedido: TOKEN_ID, periodo: "30d" },
    ];

    for (const filters of samples) {
      expect(parseIntegrationLogFilters(integrationLogSearch(filters))).toEqual(filters);
    }
  });

  it("os valores passam inteiros pela query string", () => {
    const filters = { ...NONE, acao: "signing_secret.rotated" as const, pedido: "5511999990000@s.whatsapp.net:3EB0" };
    const query = new URLSearchParams(integrationLogSearch(filters));

    expect(parseIntegrationLogFilters(Object.fromEntries(new URLSearchParams(query.toString())))).toEqual(filters);
  });
});

describe("isIntegrationStatus", () => {
  it("só `ok` e `error`", () => {
    expect([isIntegrationStatus("ok"), isIntegrationStatus("error")]).toEqual([true, true]);
    expect([isIntegrationStatus("OK"), isIntegrationStatus(""), isIntegrationStatus(null)]).toEqual([false, false, false]);
  });
});

// A lista de ações é escrita à mão em types.ts, longe de quem grava. Estes
// testes falham se um lado mudar sem o outro: ação nova sem entrar no filtro, ou
// ação do filtro que ninguém mais grava.
describe("INTEGRATION_LOG_ACTIONS confere com quem grava", () => {
  it("API v1: os métodos que as rotas exportam", () => {
    const dir = path.join(process.cwd(), "src/app/api/v1");
    const methods = new Set<string>();
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (path.basename(file) !== "route.ts") continue;
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const match of source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(match[1]);
    }

    expect(methods.size).toBeGreaterThan(2);
    expect([...INTEGRATION_LOG_ACTIONS.api_v1].sort()).toEqual([...methods].sort());
  });

  it("repasse: o evento da mensagem, o do teste de conexão e a trilha da chave", () => {
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/connection/agent/signing-secret/route.ts"),
      "utf8"
    );
    const trail = /action: "(\w+)" \| "(\w+)" \| "(\w+)"/.exec(route)?.slice(1) ?? [];

    expect(route).toContain("action: `signing_secret.${action}`");
    expect(trail).toHaveLength(3);
    expect([...INTEGRATION_LOG_ACTIONS.relay].sort()).toEqual(
      [RELAY_EVENT, PING_EVENT, ...trail.map((action) => `signing_secret.${action}`)].sort()
    );
  });

  it("webhooks: cada ação da trilha é gravada por uma rota de /api/webhooks", () => {
    const dir = path.join(process.cwd(), "src/app/api/webhooks");
    const written = new Set<string>();
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (path.basename(file) !== "route.ts") continue;
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const match of source.matchAll(/auditWebhook\(supabase, (?:"([\w.]+)"|(PING_EVENT))/g)) {
        written.add(match[1] ?? PING_EVENT);
      }
    }

    expect([...INTEGRATION_LOG_ACTIONS.webhooks].sort()).toEqual([...written].sort());
  });
});
