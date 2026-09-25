// Onde entra a linha "mensagens não lidas".
//
// `chat_conversations.unread_count` conta mensagens de ENTRADA ainda não lidas.
// A rota devolve o valor de antes de zerar, então dá para achar a fronteira
// contando as `unreadCount` últimas mensagens inbound da janela carregada.
//
// A âncora é um id, calculado UMA vez ao abrir a conversa. Recalcular a cada
// render moveria a linha conforme mensagem nova chega — que é exatamente o que
// o operador não quer: ela marca onde ele parou, não onde a conversa está.

export type DividerMessage = {
  id: string;
  direction: string;
};

/**
 * Id da primeira mensagem não lida, ou null quando não há linha a desenhar.
 *
 * Se a janela carregada tem MENOS mensagens de entrada que o contador, a
 * fronteira é mais antiga que o que está na tela — e aí tudo que foi carregado
 * é não lido, então a linha vai na primeira inbound da janela.
 */
export function findFirstUnreadId(
  messages: DividerMessage[],
  unreadCount: number
): string | null {
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) return null;

  let seen = 0;
  let oldestInbound: string | null = null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.direction !== "inbound") continue;

    seen += 1;
    oldestInbound = message.id;
    if (seen === unreadCount) return message.id;
  }

  return oldestInbound;
}
