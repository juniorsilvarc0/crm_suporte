/**
 * Identidade das abas do Rastreamento — **arquivo neutro, sem `"use client"`**.
 *
 * ⚠️ Isto vivia dentro de `components/tracking-tabs.tsx`, que é client, e a
 * página (server) chamava `parseTrackingTab` para ler o `?aba=`. Compila, passa
 * no `build` e **quebra em runtime**: "Attempted to call parseTrackingTab() from
 * the server but parseTrackingTab is on the client". A fronteira RSC só reclama
 * na hora de renderizar, então nenhum portão local pega isso — derrubou a tela
 * inteira em produção.
 *
 * Mesmo padrão de `features/meta/lead-attribution.ts`: o que os dois lados
 * precisam mora num módulo que não declara ambiente.
 */

export const trackingTabs = ["visao", "custos", "campanhas", "entrega"] as const;
export type TrackingTab = (typeof trackingTabs)[number];

export const DEFAULT_TRACKING_TAB: TrackingTab = "visao";

/** Valida o `?aba=` da URL. Valor estranho cai na primeira aba. */
export function parseTrackingTab(value: string | undefined): TrackingTab {
  return trackingTabs.includes(value as TrackingTab)
    ? (value as TrackingTab)
    : DEFAULT_TRACKING_TAB;
}

export const trackingTabLabels: Record<TrackingTab, string> = {
  visao: "Visão geral",
  custos: "Custos",
  campanhas: "Campanhas",
  entrega: "Entrega",
};
