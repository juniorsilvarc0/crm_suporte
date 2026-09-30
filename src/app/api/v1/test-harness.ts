import type { Mock } from "vitest";

// Só para os testes das rotas da v1 (não é rota: o varredor só olha route.*).
// Um Supabase falso que GRAVA a cadeia de cada `from()` e de cada `rpc()`: os
// testes conferem os filtros que chegariam ao PostgREST, não só a resposta. O
// responder de cada tabela recebe a cadeia para saber QUAL consulta é.
//
// Tudo é mutado no lugar (h.tables.x = …, h.clearChains()): o teste guarda a
// referência de `h` e nunca troca os objetos por outros.

export type Call = [string, ...unknown[]];
export type DbError = { message: string; code?: string; details?: string; hint?: string };
export type Result = { data: unknown; error: DbError | null };
export type Responder = (calls: Call[]) => Result;
export type RpcResponder = (args: Record<string, unknown>) => Result;

export type Harness = {
  tables: Record<string, Responder>;
  rpcs: Record<string, RpcResponder>;
  chains: Record<string, Call[][]>;
  rpcCalls: [string, Record<string, unknown>][];
  /** Escopos do token da requisição (lidos a cada chamada). */
  scopes: string[];
  actorType: "ai" | "api";
  reset(scopes: string[]): void;
  clearChains(): void;
  lastChain(table: string): Call[];
  request(
    path: string,
    init?: { method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> }
  ): Request;
};

/** A chamada exata (mesmo método e argumentos) está na cadeia. */
export const has = (calls: Call[], ...call: unknown[]) =>
  calls.some(
    (c) =>
      c.length === call.length &&
      c.every((value, index) => Object.is(value, call[index]) || JSON.stringify(value) === JSON.stringify(call[index]))
  );

/** `.eq(column, value)` está na cadeia. */
export const where = (calls: Call[], column: string, value: unknown) => has(calls, "eq", column, value);

const empty: Responder = () => ({ data: null, error: null });

export function createHarness(adminClientMock: Mock): Harness {
  let ip = 0;

  const h: Harness = {
    tables: {},
    rpcs: {},
    chains: {},
    rpcCalls: [],
    scopes: [],
    actorType: "ai",
    reset(scopes) {
      h.clearChains();
      h.rpcCalls.length = 0;
      h.scopes = scopes;
      h.actorType = "ai";
      for (const key of Object.keys(h.tables)) delete h.tables[key];
      for (const key of Object.keys(h.rpcs)) delete h.rpcs[key];
      Object.assign(h.tables, {
        api_tokens: () => ({
          data: {
            id: "tok-1",
            name: "IA",
            token_prefix: "crmsuporte_a",
            scopes: h.scopes,
            actor_type: h.actorType,
            rate_limit_per_min: 100_000,
            expires_at: null,
            last_used_at: new Date().toISOString(),
          },
          error: null,
        }),
        integration_logs: empty,
      } satisfies Record<string, Responder>);
      Object.assign(h.rpcs, {
        api_idempotency_begin: () => ({ data: { outcome: "started", attempt_id: "att-1" }, error: null }),
        api_idempotency_finish: () => ({ data: null, error: null }),
        api_idempotency_release: () => ({ data: null, error: null }),
      } satisfies Record<string, RpcResponder>);
      adminClientMock.mockImplementation(() => ({
        from: (table: string) => builder(table),
        rpc: async (name: string, args: Record<string, unknown>) => {
          h.rpcCalls.push([name, args]);
          const respond = h.rpcs[name] ?? (() => ({ data: null, error: { message: `rpc ${name} não mockada` } }));
          return respond(args);
        },
      }));
    },
    clearChains() {
      for (const key of Object.keys(h.chains)) delete h.chains[key];
    },
    lastChain(table) {
      return h.chains[table]?.at(-1) ?? [];
    },
    request(path, init = {}) {
      ip += 1;
      const hasBody = init.body !== undefined || init.rawBody !== undefined;
      return new Request(`http://crm.test/api/v1${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: "Bearer crmsuporte_x",
          "x-forwarded-for": `203.0.113.${(ip % 250) + 1}`,
          ...(hasBody ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      });
    },
  };

  function builder(table: string): unknown {
    const calls: Call[] = [];
    (h.chains[table] ??= []).push(calls);
    const respond = () => (h.tables[table] ?? empty)(calls);
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(respond()).then(resolve, reject);
          }
          if (prop === "maybeSingle" || prop === "single") {
            return async () => {
              calls.push([String(prop)]);
              return respond();
            };
          }
          return (...args: unknown[]) => {
            calls.push([String(prop), ...args]);
            return chain;
          };
        },
      }
    );
    return chain;
  }

  return h;
}
