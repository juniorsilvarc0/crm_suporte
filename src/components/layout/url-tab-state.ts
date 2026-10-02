// A aba de uma página mora na URL (`?aba=`): recarregar ou mandar o link abre a
// mesma aba. A primeira da lista é a padrão e fica FORA da URL (link limpo),
// como os filtros padrão da lista de tickets.
//
// Arquivo neutro, sem "use client": a página (server) lê a aba aberta com as
// mesmas funções que o componente das abas usa.

export type UrlTab<T extends string = string> = {
  value: T;
  label: string;
  /**
   * Não desmonta ao trocar de aba. Para o bloco que guarda estado que não volta
   * (ex.: a chave gerada, que só aparece uma vez). O padrão é desmontar.
   */
  keepMounted?: boolean;
};

export const URL_TAB_PARAM = "aba";

/** `?aba=` lido da URL; ausente ou desconhecido cai na primeira aba. */
export function parseUrlTab<T extends string>(tabs: readonly [UrlTab<T>, ...UrlTab<T>[]], value: unknown): T {
  return tabs.find((tab) => tab.value === value)?.value ?? tabs[0].value;
}

/** A URL da aba: só `?aba=`, e nenhum parâmetro quando é a padrão. */
export function urlTabHref<T extends string>(
  tabs: readonly [UrlTab<T>, ...UrlTab<T>[]],
  pathname: string,
  tab: T
): string {
  return tab === tabs[0].value
    ? pathname
    : `${pathname}?${new URLSearchParams({ [URL_TAB_PARAM]: tab }).toString()}`;
}
