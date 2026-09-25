import type { ConversationBox } from "@/features/chat/lib/chat-filters";
import type { ChatConversation } from "@/features/chat/types";

/**
 * Ordem e pertencimento da lista lateral de conversas.
 *
 * Vive aqui, fora do hook, porque é regra de negócio pura — e porque o bug que
 * originou este arquivo (conversa com mensagem nova que não subia) passou meses
 * despercebido justamente por estar embutido num `setState`.
 */

/** Instante da última mensagem, ou `null` quando não há data utilizável. */
function lastMessageTime(conversation: ChatConversation): number | null {
  if (!conversation.last_message_at) return null;
  const time = Date.parse(conversation.last_message_at);
  return Number.isNaN(time) ? null : time;
}

/** Instante em que foi fixada, ou `null` quando está solta. */
function pinnedTime(conversation: ChatConversation): number | null {
  if (!conversation.pinned_at) return null;
  const time = Date.parse(conversation.pinned_at);
  return Number.isNaN(time) ? null : time;
}

/**
 * Fixadas no topo; dentro de cada grupo, mais recente primeiro; sem data por
 * último.
 *
 * É a MESMA ordem do `.order("pinned_at", …).order("last_message_at", …)` da
 * consulta inicial. As duas precisam concordar, senão a lista muda de ordem
 * sozinha no primeiro evento do realtime.
 *
 * A fixada mais recente fica acima das outras fixadas, como no WhatsApp — é
 * para isso que `pinned_at` é data e não booleano.
 */
export function compareByLastMessage(
  a: ChatConversation,
  b: ChatConversation
): number {
  const pinA = pinnedTime(a);
  const pinB = pinnedTime(b);
  if (pinA !== null && pinB === null) return -1;
  if (pinA === null && pinB !== null) return 1;
  if (pinA !== null && pinB !== null && pinA !== pinB) return pinB - pinA;

  const timeA = lastMessageTime(a);
  const timeB = lastMessageTime(b);
  if (timeA === null && timeB === null) return 0;
  if (timeA === null) return 1;
  if (timeB === null) return -1;
  return timeB - timeA;
}

/**
 * A conversa pertence à CAIXA carregada?
 *
 * ⚠️ Só a caixa — arquivada ou não. Responsável, não lidas, etapa e etiqueta são
 * filtros de render (`chat-filters.ts`) e **não** decidem pertencimento à lista
 * em memória. Essa separação é o que faz o Realtime acertar sozinho: a conversa
 * que muda de `bot` para `human`, ou que fica sem mensagem não lida, continua na
 * lista carregada e some (ou volta) só da visão filtrada — sem reconsulta.
 *
 * Antes esta função também recortava por status, e a consequência era dupla:
 * cada clique num chip refazia a busca inteira, e a conversa que mudava de
 * status pelo Realtime era **removida da lista** em vez de reavaliada.
 */
export function conversationMatchesBox(
  conversation: ChatConversation,
  box: ConversationBox
): boolean {
  if (conversation.removed_at) return false;
  if (box === "archived") return Boolean(conversation.archived_at);
  return !conversation.archived_at;
}

/**
 * Aplica um UPDATE (do realtime ou de uma ação local) na lista.
 *
 * Três comportamentos que não são detalhe:
 *
 * 1. **Conversa fora da lista devolve a MESMA referência.** O canal do realtime
 *    não tem filtro: chega UPDATE das 407 conversas, e cada mensagem recebida
 *    gera dois eventos (o upsert e o `increment_unread`). Devolver array novo
 *    aqui re-renderizava a tela inteira à toa.
 * 2. **Quem sai da CAIXA sai da lista** — arquivar, desarquivar ou remover.
 *    Mudar de status (bot ↔ human) não tira ninguém daqui: isso é filtro de
 *    render, e a conversa precisa continuar carregada para reaparecer quando o
 *    operador trocar de chip.
 * 3. **Mensagem nova sobe.** A ordenação existia só na consulta inicial: o
 *    contato que respondia depois de três dias continuava na posição 200 e o
 *    operador nunca via a mensagem chegar.
 */
export function mergeConversationUpdate(
  list: ChatConversation[],
  updated: Partial<ChatConversation> & { id: string },
  box: ConversationBox
): ChatConversation[] {
  const index = list.findIndex((conversation) => conversation.id === updated.id);
  if (index === -1) return list;

  const next = { ...list[index], ...updated };
  if (!conversationMatchesBox(next, box)) {
    return list.filter((_, position) => position !== index);
  }

  const merged = [...list];
  merged[index] = next;
  // Reordena só quando uma das CHAVES DE ORDEM mudou. `sort` é estável desde o
  // ES2019, então reordenar com as chaves intactas seria trabalho sem efeito.
  //
  // ⚠️ `pinned_at` entra aqui junto com `last_message_at`: fixar não mexe na
  // hora da última mensagem, e sem esta comparação a conversa fixada só subia
  // ao topo na próxima recarga da página.
  if (
    next.last_message_at === list[index].last_message_at &&
    next.pinned_at === list[index].pinned_at
  ) {
    return merged;
  }
  return merged.sort(compareByLastMessage);
}

/**
 * Aplica o payload completo de Realtime e também restaura na lista uma
 * conversa previamente removida. Payload parcial de linha ausente continua
 * devolvendo a mesma referência: não há dados suficientes para inseri-la.
 */
export function mergeConversationRealtimeUpdate(
  list: ChatConversation[],
  updated: Partial<ChatConversation> & { id: string },
  box: ConversationBox,
  search: string
): ChatConversation[] {
  if (list.some((conversation) => conversation.id === updated.id)) {
    return mergeConversationUpdate(list, updated, box);
  }

  if (!("external_id" in updated)) return list;
  const candidate = updated as ChatConversation;
  if (!conversationMatchesBox(candidate, box)) return list;

  const term = search.trim().toLowerCase();
  if (
    term &&
    !(candidate.contact_name ?? "").toLowerCase().includes(term) &&
    !(candidate.contact_phone ?? "").toLowerCase().includes(term)
  ) {
    return list;
  }

  return [candidate, ...list].sort(compareByLastMessage);
}
