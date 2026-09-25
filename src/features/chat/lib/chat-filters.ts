import {
  conversationMatchesTagFilter,
  type TagsByConversation,
} from "@/features/chat/lib/conversation-tags";
import type { ChatConversation, StatusFilter } from "@/features/chat/types";

/**
 * Filtros da lista de conversas.
 *
 * ## Onde cada filtro acontece
 *
 * A **caixa** (ativas × arquivadas) e a **busca** são do servidor: são conjuntos
 * de dados diferentes, e carregar os dois juntos dobraria a resposta.
 *
 * Todo o resto é filtro de RENDER sobre a lista já carregada. Não é atalho: é o
 * que faz clicar num chip custar zero rede — antes, alternar `IA`/`Humano`
 * refazia a consulta inteira — e é o que faz o Realtime acertar sozinho. Uma
 * conversa que muda de status, que recebe mensagem ou que é marcada como lida
 * chega pelo canal que já existe, e ela entra ou sai da lista filtrada sem
 * ninguém precisar reconsultar nada.
 *
 * ⚠️ Isto vale porque a lista vem inteira do banco (não há paginação na barra
 * lateral). Quando ela ganhar `.range()`, `unread` vira filtro de query — tem
 * coluna indexável (`unread_count`).
 *
 * ## O que combina com o quê
 *
 * | Filtro | Tipo | Combina |
 * |---|---|---|
 * | `status` (Tudo/IA/Humano/Resolvidos) | **exclusivo** | com todos os demais |
 * | `unread` | alternável | sim |
 * | `tags` (etiquetas) | multi, **OU** entre etiquetas | sim |
 *
 * Entre grupos é **E**: `IA + Não lidas + VIP` devolve o que satisfaz os três.
 * Dentro de `tags` é **OU**, porque exigir duas etiquetas quase sempre
 * devolveria nada — uma lista vazia que parece defeito.
 */
export type ChatFilters = {
  /** Exclusivo. `archived` é a caixa; os demais são o responsável. */
  status: StatusFilter;
  /** Só conversas com mensagem não lida. */
  unread: boolean;
  /** Ids de etiqueta. Vazio = todas. */
  tags: string[];
};

export const EMPTY_FILTERS: ChatFilters = {
  status: "all",
  unread: false,
  tags: [],
};

/**
 * A caixa que o servidor precisa carregar. É o ÚNICO recorte que ainda vale uma
 * consulta nova — o resto se resolve na lista que já está na memória.
 */
export type ConversationBox = "active" | "archived";

export function boxOf(filters: ChatFilters): ConversationBox {
  return filters.status === "archived" ? "archived" : "active";
}

/** A conversa passa pelos filtros de render? (a caixa já foi decidida na carga) */
export function matchesChatFilters(
  conversation: ChatConversation,
  filters: ChatFilters,
  tagsByConversation: TagsByConversation
): boolean {
  const { status, unread, tags } = filters;

  // `archived` é caixa, não responsável: dentro dela valem todos os status.
  if (status !== "all" && status !== "archived" && conversation.status !== status) {
    return false;
  }

  if (unread && conversation.unread_count <= 0) return false;

  // A regra de etiqueta mora no módulo de etiquetas, e é a MESMA que a lista já
  // usava — aqui ela só ganhou mais de um valor.
  if (!conversationMatchesTagFilter(tagsByConversation, conversation.id, tags)) {
    return false;
  }

  return true;
}

/** Quantos filtros o operador aplicou — o número do indicador e do "Limpar". */
export function countActiveFilters(filters: ChatFilters): number {
  const responsible =
    filters.status !== "all" && filters.status !== "archived" ? 1 : 0;
  return responsible + (filters.unread ? 1 : 0) + filters.tags.length;
}

/**
 * Zera os filtros **mantendo a caixa**. Quem está nas arquivadas e limpa os
 * filtros quer ver todas as arquivadas — não ser jogado de volta para a caixa
 * de entrada sem ter pedido.
 */
export function clearChatFilters(filters: ChatFilters): ChatFilters {
  return {
    ...EMPTY_FILTERS,
    status: filters.status === "archived" ? "archived" : "all",
  };
}

/** Liga/desliga um item de uma lista de filtro, preservando a ordem de entrada. */
export function toggleFilterValue(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}
