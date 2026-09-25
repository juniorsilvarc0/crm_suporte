export const CONVERSATION_SWIPE_ACTION_WIDTH = 76;
export const CONVERSATION_SWIPE_WIDTH = CONVERSATION_SWIPE_ACTION_WIDTH * 2;
export const CONVERSATION_LONG_PRESS_MS = 500;

/**
 * Quanto o dedo pode escorregar antes de o toque deixar de ser toque.
 *
 * É **menor** que `AXIS_THRESHOLD` de propósito. O toque longo morre no primeiro
 * sinal de movimento; o arraste só nasce quando o gesto tem direção clara. Entre
 * os dois valores o gesto não é nem um nem outro — e nessa faixa ele continua
 * sendo um clique, que é o caso mais comum de todos.
 */
export const LONG_PRESS_MOVE_TOLERANCE = 10;

/**
 * 12 px, não 8. Um toque de polegar em tela de celular escorrega de 6 a 10 px
 * sem que a pessoa perceba; com 8 px o toque de abrir a conversa era
 * classificado como arraste e o clique acabava engolido.
 */
const AXIS_THRESHOLD = 12;

/**
 * O horizontal precisa vencer o vertical com folga. Com 1.15 a primeira amostra
 * de uma rolagem na diagonal (dx 14 / dy 12) travava o eixo em horizontal e a
 * lista parava de rolar no meio do gesto.
 */
const HORIZONTAL_DOMINANCE = 1.5;

export type SwipeAxis = "pending" | "horizontal" | "vertical";

export function detectConversationSwipeAxis(deltaX: number, deltaY: number): SwipeAxis {
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);
  if (Math.max(horizontal, vertical) < AXIS_THRESHOLD) return "pending";
  return horizontal > vertical * HORIZONTAL_DOMINANCE ? "horizontal" : "vertical";
}

/**
 * Lado revelado pelo arraste.
 *
 * `trailing` é o de sempre — puxar para a ESQUERDA descobre "Mais" e
 * "Arquivar" à direita. `leading` é o novo: puxar para a DIREITA descobre
 * "Não lida" e "Fixar" à esquerda, como no iOS.
 */
export type SwipeSide = "leading" | "trailing" | null;

/** Fração da largura a partir da qual a linha assenta aberta em vez de voltar. */
const OPEN_THRESHOLD = 0.35;

export function clampConversationSwipe(offset: number): number {
  return Math.max(
    -CONVERSATION_SWIPE_WIDTH,
    Math.min(CONVERSATION_SWIPE_WIDTH, offset)
  );
}

/**
 * Onde a linha assenta quando o dedo sai.
 *
 * Devolve o lado em vez de um booleano porque agora existem dois: com `true` /
 * `false` não dava para dizer *qual* faixa ficou aberta, e as duas ocupam a
 * mesma linha.
 */
export function settleConversationSwipe(offset: number): SwipeSide {
  const threshold = CONVERSATION_SWIPE_WIDTH * OPEN_THRESHOLD;
  if (offset <= -threshold) return "trailing";
  if (offset >= threshold) return "leading";
  return null;
}

/** Deslocamento em repouso de cada lado. É o que a linha anima até. */
export function conversationSwipeOffset(side: SwipeSide): number {
  if (side === "trailing") return -CONVERSATION_SWIPE_WIDTH;
  if (side === "leading") return CONVERSATION_SWIPE_WIDTH;
  return 0;
}

/**
 * Qualquer movimento acima da tolerância mata o toque longo pendente.
 *
 * Sem isto, encostar o dedo para segurar a lista já em rolagem abria a gaveta
 * meio segundo depois, sem que ninguém tivesse pedido nada.
 */
export function cancelsConversationLongPress(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_TOLERANCE;
}

/**
 * O clique só é engolido quando a linha **andou de verdade**.
 *
 * Antes, todo gesto classificado como horizontal engolia o clique seguinte por
 * 400 ms — inclusive o que terminava com a linha exatamente onde começou. Era o
 * motivo de "clico no nome e não entra na conversa": o toque escorregava para o
 * lado fechado (offset já em 0, arraste para a direita, tudo cortado pelo
 * clamp), a linha não se mexia, e ainda assim o clique era descartado.
 */
export function conversationSwipeMoved(startOffset: number, finalOffset: number): boolean {
  return Math.abs(finalOffset - startOffset) >= 1;
}
