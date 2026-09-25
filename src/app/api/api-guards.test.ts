// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isPublicApiRoute } from "@/lib/auth/route-guard";

/**
 * Contrato de autorização das rotas /api.
 *
 * O proxy só confere a ASSINATURA do cookie; quem foi desativado (ou tem papel
 * que o app não conhece) segue com um cookie válido por até 7 dias. Por isso
 * toda rota de sessão precisa perguntar ao BANCO se o usuário está ativo —
 * `requireDashboardUser`, `requireDashboardAdmin` ou `getDashboardViewer`.
 *
 * Este teste falha se aparecer handler que não chama nenhum deles, direto ou
 * por uma função local do mesmo arquivo. Rota pública (webhook, login) é
 * decidida pela mesma lista do guard, então abrir um prefixo novo lá já tira
 * a rota daqui — e o handler dela passa a ser responsável pela própria auth.
 */

const API_DIR = path.join(process.cwd(), "src/app/api");
const GUARDS = ["requireDashboardUser(", "requireDashboardAdmin(", "getDashboardViewer("];
const HANDLER_RE = /export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g;
const LOCAL_FN_RE = /(?:async )?function (\w+)\s*\(/g;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/** `/src/app/api/chat/conversations/[id]/route.ts` → `/api/chat/conversations/[id]/`. */
function routePath(file: string): string {
  const relative = path.relative(path.join(process.cwd(), "src/app"), path.dirname(file));
  return `/${relative.split(path.sep).join("/")}/`;
}

/** Corpo de cada função declarada no arquivo, até a próxima declaração de topo. */
function functionBodies(source: string): Map<string, string> {
  const starts = [...source.matchAll(LOCAL_FN_RE)].map((match) => ({
    name: match[1],
    index: match.index ?? 0,
  }));
  return new Map(
    starts.map(({ name, index }, i) => [name, source.slice(index, starts[i + 1]?.index ?? source.length)])
  );
}

const callsGuard = (body: string) => GUARDS.some((guard) => body.includes(guard));

describe("rotas /api de sessão", () => {
  const files = routeFiles(API_DIR).filter((file) => !isPublicApiRoute(routePath(file)));

  it("encontra as rotas (o teste não pode passar varrendo uma pasta vazia)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s: todo handler confirma o usuário no banco",
    (_label, file) => {
      const source = readFileSync(file, "utf8");
      const bodies = functionBodies(source);
      const guardedHelpers = [...bodies]
        .filter(([, body]) => callsGuard(body))
        .map(([name]) => `${name}(`);

      const handlers = [...source.matchAll(HANDLER_RE)].map((match) => match[1]);
      expect(handlers.length).toBeGreaterThan(0);

      for (const handler of handlers) {
        const body = bodies.get(handler) ?? "";
        const guarded =
          callsGuard(body) || guardedHelpers.some((helper) => helper !== `${handler}(` && body.includes(helper));
        expect(guarded, `${handler} sem guard de banco`).toBe(true);
      }
    }
  );
});
