// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contrato de autorização das PÁGINAS do painel (irmão de api-guards.test.ts).
 *
 * O layout de `(dashboard)` confere o usuário no banco, mas layout não roda de
 * novo na navegação pelo cliente, e o proxy só confere a assinatura do cookie:
 * um usuário desativado segue com cookie válido por até 7 dias. Página que lê
 * dado no servidor (importa de `features/<dominio>/queries/`, com service
 * role) precisa confirmar o usuário no BANCO antes da primeira consulta —
 * `getDashboardViewer()` com redirect, ou `requireAdminPage()`.
 *
 * Achado da revisão da Fase 3: /app/clientes e /app/contatos listavam a base
 * inteira sem isso.
 */

const DASHBOARD_DIR = path.join(process.cwd(), "src/app/(dashboard)");
const QUERY_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*"@\/features\/[a-z-]+\/queries\/[^"]+"/g;
const GUARDS = ["getDashboardViewer(", "requireAdminPage("];

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

/** Nomes importados de queries (sem `type`), como chamadas: `getX(`. */
function queryCalls(source: string): string[] {
  return [...source.matchAll(QUERY_IMPORT_RE)].flatMap((match) =>
    match[1]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name && !name.startsWith("type "))
      .map((name) => `${name.split(/\s+as\s+/).pop()}(`)
  );
}

/** Confirma o usuário antes da 1ª consulta e testa o resultado. */
export function guardsBeforeQueries(source: string): boolean {
  const calls = queryCalls(source);
  if (calls.length === 0) return true;
  // Corpo depois dos imports: o nome aparece no import antes de ser chamado.
  const body = source.slice(source.lastIndexOf("import "));
  const at = (needles: string[]) =>
    Math.min(...needles.map((needle) => body.indexOf(needle)).filter((index) => index >= 0));
  const guardAt = at(GUARDS);
  const queryAt = at(calls);
  if (!Number.isFinite(guardAt) || guardAt > queryAt) return false;
  // requireAdminPage redireciona sozinho; getDashboardViewer precisa do teste:
  // `if (!viewer)` (redirect), ou a consulta só roda com viewer
  // (`viewer ? await getX(...)`, como o mural de notas do Início).
  // `getX(viewer?.id)` NÃO conta: consulta mesmo sem usuário.
  const between = body.slice(guardAt, queryAt);
  return (
    body.includes("requireAdminPage(") ||
    /if \(!viewer\)/.test(between) ||
    /\bviewer\s*\?\s*await\s/.test(between) ||
    /\bviewer\s*&&\s*await\s/.test(between)
  );
}

describe("regra do contrato", () => {
  it("recusa página que consulta sem confirmar o usuário", () => {
    const source = `import { getCustomersPage } from "@/features/customers/queries/get-customers-page";
      export default async function Page() { const page = await getCustomersPage({}); }`;
    expect(guardsBeforeQueries(source)).toBe(false);
  });

  it("recusa guard depois da consulta ou sem testar o resultado", () => {
    const after = `import { getX } from "@/features/x/queries/get-x";
      export default async function Page() { const x = await getX(); const viewer = await getDashboardViewer(); if (!viewer) redirect("/"); }`;
    const untested = `import { getX } from "@/features/x/queries/get-x";
      export default async function Page() { const viewer = await getDashboardViewer(); const x = await getX(viewer?.id); }`;
    expect(guardsBeforeQueries(after)).toBe(false);
    expect(guardsBeforeQueries(untested)).toBe(false);
  });

  it("aceita a consulta que só roda com usuário confirmado", () => {
    const source = `import { getNotes } from "@/features/home/queries/get-notes";
      export default async function Page() { const viewer = await getDashboardViewer();
      const notes = viewer
        ? await getNotes(viewer.id)
        : null; }`;
    expect(guardsBeforeQueries(source)).toBe(true);
  });

  it("aceita o guard testado antes da consulta", () => {
    const source = `import { getX } from "@/features/x/queries/get-x";
      export default async function Page() { const viewer = await getDashboardViewer(); if (!viewer) redirect("/"); const x = await getX(); }`;
    expect(guardsBeforeQueries(source)).toBe(true);
  });
});

describe("páginas do painel", () => {
  const files = pageFiles(DASHBOARD_DIR);

  it("encontra as páginas (o teste não pode passar varrendo uma pasta vazia)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s: confirma o usuário no banco antes de consultar",
    (_label, file) => {
      expect(guardsBeforeQueries(readFileSync(file, "utf8"))).toBe(true);
    }
  );
});
