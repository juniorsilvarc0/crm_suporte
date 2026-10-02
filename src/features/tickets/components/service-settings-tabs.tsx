"use client";

import type { ReactNode } from "react";

import { parseUrlTab, urlTabHref } from "@/components/layout/url-tab-state";
import { UrlTabs } from "@/components/layout/url-tabs";

// As abas de /app/configuracoes/atendimento, na ordem da tela. A aba mora na
// URL (`?aba=`); a padrão (Filas) fica FORA da URL. O comportamento é o de
// `UrlTabs`, que as páginas de ajustes compartilham.
export const SERVICE_SETTINGS_TABS = [
  { value: "filas", label: "Filas" },
  { value: "categorias", label: "Categorias" },
  { value: "sla", label: "SLA" },
  { value: "status", label: "Status" },
] as const;

export type ServiceSettingsTab = (typeof SERVICE_SETTINGS_TABS)[number]["value"];

/** `?aba=` lido da URL; ausente ou desconhecido cai em Filas. */
export function parseServiceSettingsTab(value: unknown): ServiceSettingsTab {
  return parseUrlTab(SERVICE_SETTINGS_TABS, value);
}

/** A URL da aba: só `?aba=`, e nenhum parâmetro quando é a padrão. */
export function serviceSettingsHref(pathname: string, tab: ServiceSettingsTab): string {
  return urlTabHref(SERVICE_SETTINGS_TABS, pathname, tab);
}

/**
 * As quatro abas da tela, com o conteúdo de cada uma montado pela página (os
 * gerenciadores já com a leitura do servidor). Só a aba aberta fica montada.
 */
export function ServiceSettingsTabs({
  panels,
}: {
  panels: Record<ServiceSettingsTab, ReactNode>;
}) {
  return <UrlTabs tabs={SERVICE_SETTINGS_TABS} panels={panels} />;
}
