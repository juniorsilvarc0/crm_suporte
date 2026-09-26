import type { TicketListParams } from "@/features/tickets/types";

// A URL de /app/tickets (UI.md §5.1: filtros e página moram na URL). A tela
// escreve a URL com estes helpers e o servidor a lê com parseTicketListParams:
// o que sai daqui é exatamente o que a allowlist de lá aceita. Padrão fica FORA
// da URL (link limpo), e `page` também — filtro novo volta à página 1. Neutro:
// a página (servidor) e a lista (client) importam.

export const TICKETS_PATH = "/app/tickets";

// Os filtros sem a página: é o que a barra edita e o que a paginação repete.
export type TicketListFilters = Omit<TicketListParams, "page">;

export const DEFAULT_TICKET_LIST_FILTERS: TicketListFilters = {
  q: "",
  status: "ativos",
  prioridade: null,
  fila: null,
  responsavel: null,
  sla: null,
  ordem: "prazo",
};

/** Os parâmetros da URL, só os que fogem do padrão (sem `page`). */
export function ticketListSearch(filters: TicketListFilters): Record<string, string> {
  const search: Record<string, string> = {};
  if (filters.q) search.q = filters.q;
  if (filters.status !== DEFAULT_TICKET_LIST_FILTERS.status) search.status = filters.status;
  if (filters.prioridade) search.prioridade = filters.prioridade;
  if (filters.fila) search.fila = filters.fila;
  if (filters.responsavel) search.responsavel = filters.responsavel;
  if (filters.sla) search.sla = filters.sla;
  if (filters.ordem !== DEFAULT_TICKET_LIST_FILTERS.ordem) search.ordem = filters.ordem;
  return search;
}

/** URL da lista com os filtros, sempre na página 1. */
export function ticketListHref(filters: TicketListFilters): string {
  const query = new URLSearchParams(ticketListSearch(filters)).toString();
  return query ? `${TICKETS_PATH}?${query}` : TICKETS_PATH;
}

/**
 * Quantos filtros do painel fogem do padrão: o número do botão "Filtros". A
 * busca tem campo próprio e a ordem não é filtro, então nenhuma das duas conta.
 */
export function countTicketFilters(filters: TicketListFilters): number {
  return (
    Number(filters.status !== DEFAULT_TICKET_LIST_FILTERS.status) +
    Number(filters.prioridade !== null) +
    Number(filters.fila !== null) +
    Number(filters.responsavel !== null) +
    Number(filters.sla !== null)
  );
}
