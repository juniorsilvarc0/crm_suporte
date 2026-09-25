"use client";

import { useSyncExternalStore } from "react";

/**
 * Media query como store externa.
 *
 * **Não use `useState` + `useEffect` aqui.** O padrão comum começa em `false` e
 * corrige depois de montar — e quando isso decide *qual componente renderizar*
 * (diálogo no desktop, gaveta no celular), o resultado não é um pisca: é o
 * conteúdo inteiro montando duas vezes, perdendo foco e o que já foi digitado.
 * Mesmo motivo do `useFunnelView` (UI.md §9).
 *
 * `useSyncExternalStore` lê o valor certo já no primeiro render do cliente.
 */

// Um listener por query, compartilhado entre todos os componentes que a usam.
const stores = new Map<
  string,
  { mql: MediaQueryList; subscribe: (cb: () => void) => () => void }
>();

function getStore(query: string) {
  const existing = stores.get(query);
  if (existing) return existing;

  const mql = window.matchMedia(query);
  const store = {
    mql,
    subscribe(callback: () => void) {
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
  };
  stores.set(query, store);
  return store;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => {};
      return getStore(query).subscribe(callback);
    },
    () => getStore(query).mql.matches,
    // No servidor não há viewport. `false` mantém o HTML do servidor igual ao
    // desktop; o cliente corrige no primeiro render, antes de pintar.
    () => false
  );
}

/**
 * Abaixo de `sm` (640px) — o mesmo ponto de corte que o resto do chat usa para
 * decidir entre folha e caixa. Não é 768: aqui `sm:` é a fronteira do desenho.
 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 639px)");
}
