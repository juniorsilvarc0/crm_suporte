import type { Tag } from "@/features/leads/types";

/** Vínculo cru vindo de `GET /api/chat/conversations/tags`. */
export type ConversationTagPair = {
  conversation_id: string;
  tag_id: string;
};

export type TagsByConversation = ReadonlyMap<string, Tag[]>;

/**
 * Etiquetas de conversa sem nenhuma.
 *
 * Constante de módulo, e não `[]` no ponto de uso: a linha da lista é `memo`, e
 * um array novo a cada render invalidaria a memo de TODA conversa sem etiqueta —
 * que é a maioria. Era isso que fazia o arraste engasgar antes.
 */
export const NO_TAGS: readonly Tag[] = Object.freeze([]);

/**
 * Indexa os vínculos por conversa, resolvendo cada `tag_id` no catálogo.
 *
 * Ordena por nome dentro de cada conversa para os chips não trocarem de lugar
 * entre uma carga e outra — o banco não garante ordem em tabela de vínculo.
 */
export function indexTagsByConversation(
  pairs: readonly ConversationTagPair[],
  tags: readonly Tag[]
): TagsByConversation {
  const catalog = new Map(tags.map((tag) => [tag.id, tag]));
  const result = new Map<string, Tag[]>();

  for (const pair of pairs) {
    const tag = catalog.get(pair.tag_id);
    // Vínculo órfão (etiqueta apagada numa corrida) é ignorado em silêncio: a
    // FK apaga em cascata, então isto só acontece entre a exclusão e a recarga.
    if (!tag) continue;
    const current = result.get(pair.conversation_id);
    if (current) current.push(tag);
    else result.set(pair.conversation_id, [tag]);
  }

  for (const list of result.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }
  return result;
}

/**
 * Aplica um vínculo (ou a remoção dele) devolvendo um mapa novo.
 *
 * ⚠️ **Só a conversa alterada ganha array novo.** Todas as outras mantêm a
 * MESMA referência, que é o que preserva o `memo` da linha (`conversation-item`
 * §"memo não é enfeite"). Reconstruir os arrays todos aqui devolveria um mapa
 * correto e uma lista que trava no arraste.
 *
 * Devolve o **mesmo mapa** quando a operação não muda nada — etiquetar o que já
 * está etiquetado, ou tirar o que não está.
 */
export function mergeTagAssignment(
  map: TagsByConversation,
  conversationId: string,
  tag: Tag,
  assigned: boolean
): TagsByConversation {
  const current = map.get(conversationId) ?? [];
  const has = current.some((item) => item.id === tag.id);
  if (has === assigned) return map;

  const next = new Map(map);
  if (assigned) {
    next.set(
      conversationId,
      [...current, tag].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    );
  } else {
    const remaining = current.filter((item) => item.id !== tag.id);
    // Conversa sem etiqueta sai do mapa em vez de guardar lista vazia: assim
    // `get` devolve `undefined` e quem consome cai no `NO_TAGS` congelado.
    if (remaining.length === 0) next.delete(conversationId);
    else next.set(conversationId, remaining);
  }
  return next;
}

/** Tira a etiqueta apagada de todas as conversas, num mapa novo. */
export function removeTagEverywhere(
  map: TagsByConversation,
  tagId: string
): TagsByConversation {
  const next = new Map<string, Tag[]>();
  let changed = false;

  for (const [conversationId, list] of map) {
    const remaining = list.filter((tag) => tag.id !== tagId);
    if (remaining.length === list.length) {
      next.set(conversationId, list);
      continue;
    }
    changed = true;
    if (remaining.length > 0) next.set(conversationId, remaining);
  }
  return changed ? next : map;
}

/**
 * A conversa passa pelo filtro de etiqueta? Sem filtro, todas passam.
 *
 * Várias etiquetas selecionadas valem **OU**: basta ter uma delas. Exigir todas
 * devolveria lista vazia na quase totalidade dos casos — poucas conversas
 * carregam duas etiquetas ao mesmo tempo, e um filtro que "não acha nada"
 * parece defeito, não precisão.
 */
export function conversationMatchesTagFilter(
  map: TagsByConversation,
  conversationId: string,
  tagIds: readonly string[]
): boolean {
  if (tagIds.length === 0) return true;
  const assigned = map.get(conversationId);
  if (!assigned || assigned.length === 0) return false;
  return assigned.some((tag) => tagIds.includes(tag.id));
}

/** Quantas conversas carregam cada etiqueta — o contador da tela de etiquetas. */
export function countConversationsByTag(
  map: TagsByConversation
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const list of map.values()) {
    for (const tag of list) {
      counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
    }
  }
  return counts;
}
