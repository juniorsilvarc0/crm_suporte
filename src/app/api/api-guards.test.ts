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
 * por uma função local do mesmo arquivo. Chamar não basta: o resultado tem de
 * ser testado (`"error" in auth` ou `!viewer`), e a chamada direta tem de vir
 * antes do primeiro acesso ao banco — `send`, `forward` e a edição de mensagem
 * chegaram a chamar o guard só para ler o nome, ou só dentro de um ramo, e um
 * usuário desativado seguia enviando pelo WhatsApp.
 *
 * Rota pública (webhook, login) é decidida pela mesma lista do guard, então
 * abrir um prefixo novo lá já tira a rota daqui — e o handler dela passa a ser
 * responsável pela própria auth.
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

// O que conta como "testou o resultado do guard".
const REJECTS = [/"error" in \w+\)\s*return/, /if \(!viewer\)/, /if \(!\(await getDashboardViewer\(\)\)\)/];
const DB_ACCESS = ["createSupabaseAdminClient(", "createSupabaseServerClient("];

const firstIndex = (body: string, needles: string[]) =>
  Math.min(...needles.map((needle) => body.indexOf(needle)).filter((index) => index >= 0));

/** Corpo sem a própria declaração (`function PATCH(`), para o nome não casar consigo. */
const bodyAfterSignature = (body: string) => body.slice(body.indexOf("(") + 1);

/**
 * Chama um guard fora de qualquer `if`, testa o resultado logo depois e, se
 * toca o banco — direto ou por função local que toca —, só depois disso.
 */
function guardsDirectly(body: string, dbCalls: string[]): boolean {
  const code = bodyAfterSignature(body);
  const guardAt = firstIndex(code, GUARDS);
  if (!Number.isFinite(guardAt)) return false;
  // Guard dentro de um ramo só protege aquele ramo. O `if` que É o teste do
  // guard (`if (!(await getDashboardViewer()))`) não conta como ramo.
  const wrapper = /if \(!\(await $/.exec(code.slice(0, guardAt));
  const guardStart = wrapper ? wrapper.index : guardAt;
  if (code.slice(0, guardStart).includes("if (")) return false;
  const dbAt = firstIndex(code, dbCalls);
  if (Number.isFinite(dbAt) && dbAt < guardAt) return false;
  const beforeDb = code.slice(guardStart, Number.isFinite(dbAt) ? dbAt : undefined);
  return REJECTS.some((pattern) => pattern.test(beforeDb));
}

/** Cada handler exportado do arquivo, e se ele confirma o usuário no banco. */
function handlerGuards(source: string): [string, boolean][] {
  const bodies = functionBodies(source);
  // Função local que acessa o banco conta como acesso ao banco para quem a chama.
  const dbHelpers = [...bodies]
    .filter(([, body]) => DB_ACCESS.some((needle) => bodyAfterSignature(body).includes(needle)))
    .map(([name]) => `${name}(`);
  const dbCallsFor = (name: string) => [...DB_ACCESS, ...dbHelpers.filter((call) => call !== `${name}(`)];

  const guardedHelpers = [...bodies]
    .filter(([name, body]) => guardsDirectly(body, dbCallsFor(name)))
    .map(([name]) => `${name}(`);

  return [...source.matchAll(HANDLER_RE)].map((match) => {
    const handler = match[1];
    const body = bodies.get(handler) ?? "";
    const code = bodyAfterSignature(body);
    const dbAt = firstIndex(code, dbCallsFor(handler));
    const viaHelper = guardedHelpers
      .filter((helper) => helper !== `${handler}(`)
      .some((helper) => {
        const at = code.indexOf(helper);
        return at >= 0 && (!Number.isFinite(dbAt) || at <= dbAt);
      });
    return [handler, guardsDirectly(body, dbCallsFor(handler)) || viaHelper];
  });
}

describe("regra do contrato", () => {
  it("recusa guard chamado só para ler o usuário", () => {
    const source = `export async function POST() {
      const supabase = createSupabaseAdminClient();
      const viewer = await getDashboardViewer();
      await send(viewer?.id ?? null);
    }`;
    expect(handlerGuards(source)).toEqual([["POST", false]]);
  });

  it("recusa guard só dentro de um ramo, com o banco acessado por helper", () => {
    // A regressão real de messages/[messageId]: `loadMessage` cria o client
    // admin, e o guard só existia no ramo de nota.
    const source = `async function loadMessage(id) {
      const supabase = createSupabaseAdminClient();
      return supabase.from("chat_messages").select("*").eq("id", id);
    }
    export async function PATCH() {
      const base = await loadMessage(id);
      if (isNote) {
        const viewer = await getDashboardViewer();
        if (!viewer) return unauthorized();
      }
      await editOnWhatsApp();
    }`;
    expect(handlerGuards(source)).toEqual([["PATCH", false]]);
  });

  it("recusa guard dentro de um ramo mesmo sem banco antes dele", () => {
    const source = `export async function DELETE() {
      if (isNote) {
        const auth = await requireDashboardUser();
        if ("error" in auth) return auth.error;
      }
      await deleteOnWhatsApp();
    }`;
    expect(handlerGuards(source)).toEqual([["DELETE", false]]);
  });

  it("recusa guard cujo resultado só é testado depois do banco", () => {
    const source = `export async function POST() {
      const viewer = await getDashboardViewer();
      const supabase = createSupabaseAdminClient();
      if (!viewer) return unauthorized();
    }`;
    expect(handlerGuards(source)).toEqual([["POST", false]]);
  });

  it("aceita o guard testado antes do banco, direto ou por helper local", () => {
    const source = `export async function POST() {
      const auth = await requireDashboardUser();
      if ("error" in auth) return auth.error;
      const supabase = createSupabaseAdminClient();
    }
    async function authorized() {
      const viewer = await getDashboardViewer();
      if (!viewer) return { error: 401 };
    }
    export async function DELETE() {
      const target = await authorized();
    }`;
    expect(handlerGuards(source)).toEqual([
      ["POST", true],
      ["DELETE", true],
    ]);
  });
});

describe("rotas /api de sessão", () => {
  const files = routeFiles(API_DIR).filter((file) => !isPublicApiRoute(routePath(file)));

  it("encontra as rotas (o teste não pode passar varrendo uma pasta vazia)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s: todo handler confirma o usuário no banco",
    (_label, file) => {
      const handlers = handlerGuards(readFileSync(file, "utf8"));
      expect(handlers.length).toBeGreaterThan(0);

      for (const [handler, guarded] of handlers) {
        expect(guarded, `${handler} sem guard de banco`).toBe(true);
      }
    }
  );
});
