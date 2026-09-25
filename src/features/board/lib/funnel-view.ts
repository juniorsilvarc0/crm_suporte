"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Preferências de visualização do funil. São escolha de quem usa, não estado de
 * navegação: ficam no localStorage e não na URL.
 *
 * localStorage é uma store externa ao React. `useSyncExternalStore` lê dela sem
 * `setState` dentro de efeito — que era o que causava o pisca-pisca: a tela
 * montava no padrão e trocava de densidade um frame depois.
 */
export type FunnelView = {
  /** Cards do Kanban em versão reduzida (nome + telefone). */
  compact: boolean;
};

const STORAGE_KEY = "crm-funnel-view";
/** Chave antiga, migrada na primeira leitura para não perder a preferência. */
const LEGACY_KEY = "crm-funnel-density";

const DEFAULT_VIEW: FunnelView = { compact: false };

const listeners = new Set<() => void>();

// O snapshot precisa ter identidade estável entre renders, senão o
// useSyncExternalStore entra em loop.
let snapshot: FunnelView | null = null;

function readStoredView(): FunnelView {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FunnelView>;
      return {
        compact: typeof parsed.compact === "boolean" ? parsed.compact : DEFAULT_VIEW.compact,
      };
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy === "compact" || legacy === "comfortable") {
      return { compact: legacy === "compact" };
    }
    return DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FunnelView {
  snapshot ??= readStoredView();
  return snapshot;
}

// O servidor sempre entrega o padrão: sem isso a hidratação diverge.
function getServerSnapshot(): FunnelView {
  return DEFAULT_VIEW;
}

function writeView(patch: Partial<FunnelView>) {
  snapshot = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Modo privado ou storage cheio: a preferência vale só para esta sessão.
  }
  for (const listener of listeners) listener();
}

export function useFunnelView() {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const updateView = useCallback((patch: Partial<FunnelView>) => writeView(patch), []);
  return { view, updateView };
}
