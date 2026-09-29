// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
