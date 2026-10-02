// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock }));

import { buildOpenApiDocument } from "@/lib/api/v1/openapi";
import { API_V1_HANDLERS } from "@/lib/api/v1/with-api";

/**
 * Contrato de autenticação da API v1.
 *
 * `/api/v1/` é prefixo público no route-guard: o proxy não pede sessão, e o
 * api-guards.test.ts de sessão deixa de ver estas rotas. Quem autentica é o
 * `withApi` (token com escopo), e ESTE teste é a única barreira automática.
 * Ele falha se aparecer rota v1 que:
 *   - não esteja num `route.ts` (o Next também serve route.tsx/.js);
 *   - exporte QUALQUER método HTTP (os 7, HEAD e OPTIONS incluídos) que não
 *     tenha saído de withApi/withPublicApi — conferido por identidade no
 *     registro API_V1_HANDLERS, qualquer que seja a forma do código;
 *   - use withPublicApi fora da lista pública (D14: só health e openapi.json);
 *   - sem token, ou com um token inválido, responda algo diferente de 401;
 *   - toque o banco sem Bearer;
 *   - tenha método fora do OpenAPI.
 */

const V1_DIR = path.join(process.cwd(), "src/app/api/v1");
const METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"] as const;
const PUBLIC_ROUTES = ["/api/v1/health", "/api/v1/openapi.json"];
/** Toda extensão que o Next pode tratar como route handler. */
const ROUTE_FILE_RE = /^route\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return ROUTE_FILE_RE.test(entry) ? [full] : [];
  });
}

/** `src/app/api/v1/tickets/[id]/route.ts` → `/api/v1/tickets/[id]`. */
function routePath(file: string): string {
  const relative = path.relative(path.join(process.cwd(), "src/app"), path.dirname(file));
  return `/${relative.split(path.sep).join("/")}`;
}

type Handler = (request: Request, context: { params: Promise<object> }) => Promise<Response>;

async function exportedHandlers(file: string): Promise<[string, Handler][]> {
  const mod = (await import(file)) as Record<string, unknown>;
  return METHODS.filter((method) => method in mod).map((method) => [method, mod[method] as Handler]);
}

const files = routeFiles(V1_DIR);
const cases = files.map((file) => [routePath(file), file] as const);
const concreteUrl = (route: string) =>
  `http://crm.test${route.replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000")}`;

beforeEach(() => {
  adminClientMock.mockReset();
  adminClientMock.mockImplementation(() => {
    throw new Error("tocou o banco");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Banco falso só com o token e o log; devolve as linhas que a rota logou. */
function tokenWith(scopes: string[]): Record<string, unknown>[] {
  const logs: Record<string, unknown>[] = [];
  const row = {
    id: "tok-varredor",
    name: "Varredor",
    token_prefix: "crmsuporte_v",
    scopes,
    actor_type: "api",
    rate_limit_per_min: 6000,
    expires_at: null,
    last_used_at: new Date().toISOString(),
  };
  adminClientMock.mockReturnValue({
    from: (table: string) =>
      table === "api_tokens"
        ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }
        : {
            insert: async (values: Record<string, unknown>) => {
              logs.push(values);
              return { error: null };
            },
          },
  });
  return logs;
}

type Operation = { summary?: string; parameters?: { name: string; in: string; required?: boolean }[] };
const openApiPath = (route: string) => route.replace(/^\/api\/v1/, "").replace(/\[([^\]]+)\]/g, "{$1}");
const operationsOf = (route: string) =>
  (buildOpenApiDocument().paths as Record<string, Record<string, Operation>>)[openApiPath(route)] ?? {};

describe("rotas /api/v1", () => {
  it("encontra as rotas (o teste não pode passar varrendo uma pasta vazia)", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("toda rota da v1 é um route.ts", () => {
    expect(files.filter((file) => path.basename(file) !== "route.ts")).toEqual([]);
  });

  it.each(cases)("%s: todo método exportado saiu de withApi/withPublicApi", async (route, file) => {
    const handlers = await exportedHandlers(file);
    expect(handlers.length, "nenhum método HTTP exportado").toBeGreaterThan(0);

    const expected = PUBLIC_ROUTES.includes(route) ? "public" : "auth";
    for (const [method, handler] of handlers) {
      expect(API_V1_HANDLERS.get(handler), `${method} fora do withApi (ou pública fora da lista)`).toBe(expected);
    }
  });

  it.each(cases)("%s: sem token é 401 sem tocar o banco", async (route, file) => {
    for (const [method, handler] of await exportedHandlers(file)) {
      const response = await handler(
        new Request(concreteUrl(route), {
          method,
          headers: { "x-forwarded-for": `198.51.100.${files.indexOf(file) + 1}` },
        }),
        { params: Promise.resolve({}) }
      );
      if (PUBLIC_ROUTES.includes(route)) {
        expect(response.status, `${method} público`).toBe(200);
      } else {
        expect(response.status, `${method} sem token`).toBe(401);
      }
      expect(adminClientMock, `${method} tocou o banco sem token`).not.toHaveBeenCalled();
    }
  });

  it.each(cases.filter(([route]) => !PUBLIC_ROUTES.includes(route)))(
    "%s: token inválido é 401 (não basta o header existir)",
    async (route, file) => {
      adminClientMock.mockReturnValue({
        from: (table: string) =>
          table === "api_tokens"
            ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
            : { insert: async () => ({ error: null }) },
      });
      for (const [method, handler] of await exportedHandlers(file)) {
        const response = await handler(
          new Request(concreteUrl(route), {
            method,
            headers: { authorization: "Bearer invalido", "x-forwarded-for": `198.51.101.${files.indexOf(file) + 1}` },
          }),
          { params: Promise.resolve({}) }
        );
        expect(response.status, `${method} com token inválido`).toBe(401);
      }
    }
  );

  // /me é a única rota com token e sem escopo (é como o integrador descobre o
  // que o token alcança). Toda outra exige escopo: o token "Sem acesso" da
  // tela (scopes vazio) não pode ler nada.
  const SCOPELESS_ROUTES = ["/api/v1/me"];
  it.each(cases.filter(([route]) => !PUBLIC_ROUTES.includes(route) && !SCOPELESS_ROUTES.includes(route)))(
    "%s: token sem escopo é 403 (toda rota exige escopo)",
    async (route, file) => {
      const row = {
        id: "tok-sem-escopo",
        name: "Sem acesso",
        token_prefix: "crmsuporte_s",
        scopes: [],
        actor_type: "api",
        rate_limit_per_min: 6000,
        expires_at: null,
        last_used_at: new Date().toISOString(),
      };
      adminClientMock.mockReturnValue({
        from: (table: string) =>
          table === "api_tokens"
            ? { select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }
            : { insert: async () => ({ error: null }) },
      });
      for (const [method, handler] of await exportedHandlers(file)) {
        const response = await handler(
          new Request(concreteUrl(route), {
            method,
            headers: { authorization: "Bearer sem-escopo", "x-forwarded-for": `198.51.102.${files.indexOf(file) + 1}` },
          }),
          { params: Promise.resolve({}) }
        );
        expect(response.status, `${method} com token sem escopo`).toBe(403);
        expect((await response.json()).error.code).toBe("insufficient_scope");
      }
    }
  );

  it.each(cases)("%s: todo método está no OpenAPI", async (route, file) => {
    const paths = buildOpenApiDocument().paths as Record<string, Record<string, unknown>>;
    const documented = paths[route.replace(/^\/api\/v1/, "").replace(/\[([^\]]+)\]/g, "{$1}")];
    expect(documented, "rota fora do OpenAPI").toBeDefined();
    for (const [method] of await exportedHandlers(file)) {
      expect(documented[method.toLowerCase()], `${method} fora do OpenAPI`).toBeDefined();
    }
  });

  const AUTHENTICATED = cases.filter(([route]) => !PUBLIC_ROUTES.includes(route));

  it.each(AUTHENTICATED)("%s: o log leva o molde da rota (o caminho do arquivo), não a URL", async (route, file) => {
    for (const [method, handler] of await exportedHandlers(file)) {
      const logs = tokenWith([]);
      const response = await handler(
        new Request(concreteUrl(route), {
          method,
          headers: { authorization: "Bearer varredor", "x-forwarded-for": `198.51.103.${files.indexOf(file) + 1}` },
        }),
        { params: Promise.resolve({}) }
      );
      expect(logs, `${method} não logou`).toHaveLength(1);
      expect(logs[0], `${method} logou outro molde`).toMatchObject({ route, action: method, http_status: response.status });
    }
  });

  it.each(AUTHENTICATED.filter(([route]) => !SCOPELESS_ROUTES.includes(route)))(
    "%s: o escopo e a Idempotency-Key que o OpenAPI anuncia são os que a rota exige",
    async (route, file) => {
      // Depois do guard o banco falso não tem as tabelas: a rota cai em 4xx/5xx. Só o 403 e o 400 da chave importam.
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const operations = operationsOf(route);
      for (const [method, handler] of await exportedHandlers(file)) {
        const operation = operations[method.toLowerCase()] ?? {};
        const scopes = [...(operation.summary ?? "").matchAll(/Escopo: `([a-z]+:[a-z*]+)`/g)].map((match) => match[1]);
        expect(scopes, `${method}: o resumo não diz "Escopo: \`x\`"`).toHaveLength(1);

        tokenWith(scopes);
        const response = await handler(
          new Request(concreteUrl(route), {
            method,
            headers: { authorization: "Bearer varredor", "x-forwarded-for": `198.51.104.${files.indexOf(file) + 1}` },
          }),
          { params: Promise.resolve({}) }
        );
        expect(response.status, `${method}: o escopo do OpenAPI (${scopes[0]}) não basta`).not.toBe(403);

        const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
        const requiresKey = body?.error?.code === "idempotency_key_required";
        const documentsKey = (operation.parameters ?? []).some(
          (parameter) => parameter.in === "header" && parameter.name === "Idempotency-Key" && parameter.required === true
        );
        expect(documentsKey, `${method}: Idempotency-Key no OpenAPI ≠ na rota`).toBe(requiresKey);
      }
    }
  );

  it("todo caminho e método do OpenAPI tem rota (o contrato não anuncia o que não existe)", async () => {
    const paths = buildOpenApiDocument().paths as Record<string, Record<string, unknown>>;
    const fileOf = new Map(cases.map(([route, file]) => [openApiPath(route), file]));
    for (const [documented, operations] of Object.entries(paths)) {
      const file = fileOf.get(documented);
      expect(file, `${documented} está no OpenAPI e não tem route.ts`).toBeDefined();
      if (!file) continue;
      const exported = (await exportedHandlers(file)).map(([method]) => method.toLowerCase()).sort();
      const announced = Object.keys(operations)
        .filter((key) => METHODS.some((method) => method.toLowerCase() === key))
        .sort();
      expect(announced, documented).toEqual(exported);
    }
  });

  it("todo $ref do OpenAPI aponta para um componente que existe", () => {
    const doc = buildOpenApiDocument();
    const refs = [...JSON.stringify(doc.paths).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((match) => match[1]);
    const known: Record<string, unknown> = doc.components.schemas;

    expect(refs.length).toBeGreaterThan(20);
    expect([...new Set(refs)].filter((name) => !(name in known))).toEqual([]);
    // E o inverso: componente que nenhuma operação usa é sobra (ou um $ref trocado).
    expect(Object.keys(known).filter((name) => !refs.includes(name))).toEqual([]);
  });
});
