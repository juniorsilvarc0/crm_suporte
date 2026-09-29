"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// As abas de /app/configuracoes/atendimento, na ordem da tela. A aba mora na
// URL (`?aba=`): recarregar ou mandar o link abre a mesma aba. A padrão (Filas)
// fica FORA da URL, como os filtros padrão da lista de tickets (link limpo).
export const SERVICE_SETTINGS_TABS = [
  { value: "filas", label: "Filas" },
  { value: "categorias", label: "Categorias" },
  { value: "sla", label: "SLA" },
  { value: "status", label: "Status" },
] as const;

export type ServiceSettingsTab = (typeof SERVICE_SETTINGS_TABS)[number]["value"];

const DEFAULT_TAB: ServiceSettingsTab = "filas";

// A pílula da página Configurações, a irmã desta no menu Ajustes: trocar de uma
// para a outra não muda o desenho das abas. 44 px de alvo no celular (UI §7).
const TRIGGER_CLASS =
  "h-11 rounded-full px-4 font-display data-active:bg-brand-gradient data-active:text-primary-foreground! data-active:shadow-sm sm:h-9";

/** `?aba=` lido da URL; ausente ou desconhecido cai em Filas. */
export function parseServiceSettingsTab(value: unknown): ServiceSettingsTab {
  return SERVICE_SETTINGS_TABS.find((tab) => tab.value === value)?.value ?? DEFAULT_TAB;
}

/** A URL da aba: só `?aba=`, e nenhum parâmetro quando é a padrão. */
export function serviceSettingsHref(pathname: string, tab: ServiceSettingsTab): string {
  return tab === DEFAULT_TAB
    ? pathname
    : `${pathname}?${new URLSearchParams({ aba: tab }).toString()}`;
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
  const router = useRouter();
  const pathname = usePathname();
  const urlTab = parseServiceSettingsTab(useSearchParams().get("aba"));
  const [, startNavigation] = useTransition();
  // A aba troca na hora; a URL confirma quando a página relida chega. Quando a
  // URL muda por fora (o item do menu, voltar do navegador), a aba segue ela.
  const [tab, setOptimisticTab] = useOptimistic(urlTab);

  // A aba já aberta não chega aqui: o Tab do Base UI ignora o clique nela.
  function changeTab(value: unknown) {
    const next = parseServiceSettingsTab(value);
    startNavigation(() => {
      setOptimisticTab(next);
      router.replace(serviceSettingsHref(pathname, next), { scroll: false });
    });
  }

  return (
    <Tabs value={tab} onValueChange={changeTab} className="min-w-0 gap-5">
      {/* O trilho rola sozinho em tela estreita; a página não (UI §5.19). */}
      <div className="overflow-x-auto overscroll-x-contain">
        <TabsList className="h-auto min-w-max gap-1 rounded-full bg-muted/60 p-1">
          {SERVICE_SETTINGS_TABS.map(({ value, label }) => (
            <TabsTrigger key={value} value={value} className={TRIGGER_CLASS}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {SERVICE_SETTINGS_TABS.map(({ value }) => (
        <TabsContent key={value} value={value}>
          {panels[value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
