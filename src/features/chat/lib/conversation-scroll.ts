export type ConversationPromotion = {
  id: string;
  previousIndex: number;
  nextIndex: number;
};

/**
 * Detecta se a conversa alterada foi para uma posição anterior da lista.
 *
 * Recebe o id que originou a atualização para não confundir a promoção real
 * com as linhas que apenas mudaram de índice como consequência dela.
 */
export function detectConversationPromotion(
  previousIds: readonly string[],
  nextIds: readonly string[],
  changedId: string
): ConversationPromotion | null {
  if (previousIds.length === 0) return null;

  const previousIndex = previousIds.indexOf(changedId);
  const nextIndex = nextIds.indexOf(changedId);
  if (nextIndex === -1) return null;

  const insertedAtTop = previousIndex === -1 && nextIndex === 0;
  const movedUp = previousIndex > nextIndex;
  if (!insertedAtTop && !movedUp) return null;

  return { id: changedId, previousIndex, nextIndex };
}

/**
 * Quantas linhas precisam ser compensadas para o mesmo conteúdo continuar no
 * topo da viewport.
 *
 * Decide **se** compensa, por índice — não **quanto**, em pixels. Desde que a
 * linha ganhou etiquetas, a lista tem altura variável, e quem converte para
 * pixel é `promotedShiftPixels`, medindo cada linha de verdade.
 */
export function promotedConversationScrollShift(
  promotion: ConversationPromotion,
  viewportIndex: number
): 0 | 1 {
  const sourceIndex =
    promotion.previousIndex === -1
      ? Number.POSITIVE_INFINITY
      : promotion.previousIndex;
  return promotion.nextIndex <= viewportIndex && sourceIndex >= viewportIndex
    ? 1
    : 0;
}

/**
 * Índice da primeira linha visível, a partir das alturas reais.
 *
 * Substitui `scrollTop / alturaDaPrimeiraLinha`, que só valia enquanto todas as
 * linhas tinham a mesma altura. Uma conversa com etiqueta é mais alta que uma
 * sem, e a primeira linha da lista pode ser justamente a mais alta — dividir por
 * ela dava um índice menor que o real e a compensação escolhia a hora errada.
 */
export function viewportIndexFromHeights(
  heights: readonly number[],
  scrollTop: number
): number {
  if (heights.length === 0) return 0;
  // Também cobre a lista escondida (celular, conversa aberta por cima): ali toda
  // altura é zero e nenhum acumulado passaria do topo.
  if (scrollTop <= 0) return 0;

  let offset = 0;
  for (let index = 0; index < heights.length; index += 1) {
    offset += heights[index];
    if (offset > scrollTop) return index;
  }
  return heights.length - 1;
}

/**
 * Quantos pixels compensar pelas linhas que entraram acima da viewport.
 *
 * Recebe ids, e não uma contagem, porque a compensação pode ficar pendente: no
 * celular a lista fica escondida atrás da conversa, com geometria zero, e só dá
 * para medir quando ela reaparece. Guardar o id preserva *qual* linha entrou.
 *
 * Linha que sumiu nesse meio-tempo entra pela altura típica — errar por uma
 * altura média é melhor que ignorar e deixar o conteúdo saltar inteiro.
 */
export function promotedShiftPixels(
  pendingIds: readonly string[],
  heightById: ReadonlyMap<string, number>,
  typicalHeight: number
): number {
  return pendingIds.reduce((total, id) => {
    const measured = heightById.get(id);
    return total + (measured && measured > 0 ? measured : typicalHeight);
  }, 0);
}
