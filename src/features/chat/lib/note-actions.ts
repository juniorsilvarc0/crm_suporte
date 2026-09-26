import type { ChatMessage } from "@/features/chat/types";

/**
 * Quem pode editar e apagar uma **anotação interna**.
 *
 * Regra separada de `message-actions.ts` de propósito: lá as três ações passam
 * pelo WhatsApp — há janela de 15 minutos, exigência de `external_id` e um
 * provedor que pode recusar. A nota **nunca saiu do nosso banco**: editar é um
 * UPDATE, apagar é um UPDATE, e nada disso depende de terceiro.
 *
 * A UI usa estes predicados para decidir o menu; a rota usa os MESMOS para
 * recusar. Duplicar a regra nos dois lados é como se ganha um item de menu que
 * sempre dá erro, ou uma rota que aceita o que a tela proíbe.
 */

export function isNoteMessage(message: Pick<ChatMessage, "type">): boolean {
  return message.type === "note";
}

/**
 * **Só o autor.** Nota é registro de equipe: deixar qualquer pessoa reescrever
 * o que a colega anotou destrói o histórico de quem falou o quê com o cliente.
 *
 * Sem janela de tempo — anotação de três dias atrás continua sendo corrigível,
 * porque não há um celular do outro lado mostrando a versão antiga.
 *
 * `viewerId` nulo (sessão sem usuário resolvido) nunca autoriza.
 */
export function canEditNote(
  message: Pick<ChatMessage, "type" | "is_deleted" | "sent_by_user_id">,
  viewerId: string | null | undefined
): boolean {
  if (!isNoteMessage(message)) return false;
  if (message.is_deleted) return false;
  if (!viewerId) return false;
  return message.sent_by_user_id === viewerId;
}

/** Mesma regra da edição: a nota é de quem escreveu. */
export function canDeleteNote(
  message: Pick<ChatMessage, "type" | "is_deleted" | "sent_by_user_id">,
  viewerId: string | null | undefined
): boolean {
  return canEditNote(message, viewerId);
}

/**
 * Como assinar a nota na bolha.
 *
 * Sem autor conhecido devolve `null` e a bolha não inventa um nome — nota
 * antiga (ou gravada por integração) fica sem assinatura, que é honesto.
 * "Você" em vez do próprio nome porque é o que a pessoa espera ler.
 */
export function noteAuthorLabel(
  message: Pick<ChatMessage, "sent_by_user_id">,
  names: ReadonlyMap<string, string>,
  viewerId: string | null | undefined
): string | null {
  const authorId = message.sent_by_user_id;
  if (!authorId) return null;
  if (viewerId && authorId === viewerId) return "Você";
  return names.get(authorId) ?? null;
}
