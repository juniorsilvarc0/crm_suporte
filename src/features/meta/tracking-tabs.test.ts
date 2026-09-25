import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRACKING_TAB,
  parseTrackingTab,
  trackingTabLabels,
  trackingTabs,
} from "@/features/meta/tracking-tabs";

describe("parseTrackingTab", () => {
  it("aceita as quatro abas", () => {
    for (const tab of trackingTabs) expect(parseTrackingTab(tab)).toBe(tab);
  });

  it("cai na primeira aba com valor estranho, ausente ou vazio", () => {
    expect(parseTrackingTab("inventada")).toBe(DEFAULT_TRACKING_TAB);
    expect(parseTrackingTab(undefined)).toBe(DEFAULT_TRACKING_TAB);
    expect(parseTrackingTab("")).toBe(DEFAULT_TRACKING_TAB);
    // `?aba=__proto__` não pode virar aba nem derrubar a página.
    expect(parseTrackingTab("__proto__")).toBe(DEFAULT_TRACKING_TAB);
  });

  it("toda aba tem rótulo", () => {
    for (const tab of trackingTabs) expect(trackingTabLabels[tab]).toBeTruthy();
  });
});

/**
 * ⚠️ **Este teste existe porque `pnpm build` NÃO pega o erro que ele pega.**
 *
 * `parseTrackingTab` foi parar dentro de `components/tracking-tabs.tsx`, que é
 * `"use client"`, e a página (server) o chamava para ler o `?aba=`. Compila,
 * passa no typecheck, passa no lint, passa no build — e explode ao renderizar,
 * em produção: *"Attempted to call parseTrackingTab() from the server but
 * parseTrackingTab is on the client"*. A tela inteira caiu.
 *
 * A regra que faltava é simples: de um módulo `"use client"`, um Server
 * Component só pode importar **componente** (PascalCase, para renderizar como
 * JSX). Função, constante ou helper precisa morar em arquivo neutro, como
 * `features/meta/lead-attribution.ts` já fazia.
 */
describe("fronteira cliente/servidor da página de Rastreamento", () => {
  const root = process.cwd();
  const pagePath = join(root, "src/app/(dashboard)/app/rastreamento/page.tsx");
  const source = readFileSync(pagePath, "utf8");

  function isClientModule(specifier: string) {
    if (!specifier.startsWith("@/")) return false;
    for (const ext of [".ts", ".tsx"]) {
      const file = join(root, "src", `${specifier.slice(2)}${ext}`);
      try {
        return /^\s*["']use client["']/.test(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
    }
    return false;
  }

  it("a página não importa função nem constante de módulo client", () => {
    const offenders: string[] = [];
    const importPattern = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;

    for (const match of source.matchAll(importPattern)) {
      const [, bindings, specifier] = match;
      if (!isClientModule(specifier)) continue;

      for (const raw of bindings.split(",")) {
        const binding = raw.trim();
        if (!binding || binding.startsWith("type ")) continue;
        const name = binding.split(/\s+as\s+/).pop()!.trim();
        // Componente é PascalCase e existe para ser renderizado como JSX — é a
        // única coisa que atravessa a fronteira legalmente.
        if (!/^[A-Z]/.test(name)) offenders.push(`${name} (de ${specifier})`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("o módulo de identidade das abas é neutro, não client", () => {
    const neutral = readFileSync(join(root, "src/features/meta/tracking-tabs.ts"), "utf8");
    expect(neutral).not.toMatch(/^\s*["']use client["']/);
  });
});
