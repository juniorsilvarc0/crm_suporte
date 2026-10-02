"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseUrlTab, URL_TAB_PARAM, urlTabHref, type UrlTab } from "@/components/layout/url-tab-state";

// A pílula das páginas de ajustes (Integrações e Atendimento): trocar de uma
// para a outra não muda o desenho das abas. 44 px de alvo no celular (UI §7).
const TRIGGER_CLASS =
  "h-11 rounded-full px-4 font-display data-active:bg-brand-gradient data-active:text-primary-foreground! data-active:shadow-sm sm:h-9";

/**
 * Abas com a aba aberta na URL (`?aba=`). O conteúdo de cada uma é montado pela
 * página (os blocos já com a leitura do servidor). Só a aba aberta fica
 * montada, salvo a marcada com `keepMounted`.
 */
export function UrlTabs<T extends string>({
  tabs,
  panels,
}: {
  tabs: readonly [UrlTab<T>, ...UrlTab<T>[]];
  panels: Record<T, ReactNode>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const urlTab = parseUrlTab(tabs, useSearchParams().get(URL_TAB_PARAM));
  const [, startNavigation] = useTransition();
  // A aba troca na hora; a URL confirma quando a página relida chega. Quando a
  // URL muda por fora (o item do menu, voltar do navegador), a aba segue ela.
  const [tab, setOptimisticTab] = useOptimistic(urlTab);

  // A aba já aberta não chega aqui: o Tab do Base UI ignora o clique nela.
  function changeTab(value: unknown) {
    const next = parseUrlTab(tabs, value);
    startNavigation(() => {
      setOptimisticTab(next);
      router.replace(urlTabHref(tabs, pathname, next), { scroll: false });
    });
  }

  return (
    <Tabs value={tab} onValueChange={changeTab} className="min-w-0 gap-5">
      {/* O trilho rola sozinho em tela estreita; a página não (UI §5.19). */}
      <div className="overflow-x-auto overscroll-x-contain">
        <TabsList className="h-auto min-w-max gap-1 rounded-full bg-muted/60 p-1">
          {tabs.map(({ value, label }) => (
            <TabsTrigger key={value} value={value} className={TRIGGER_CLASS}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {tabs.map(({ value, keepMounted }) => (
        <TabsContent key={value} value={value} keepMounted={keepMounted}>
          {panels[value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
