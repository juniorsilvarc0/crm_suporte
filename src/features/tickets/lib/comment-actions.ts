import type { TicketComment } from "@/features/tickets/types";

/**
 * Quem pode editar e apagar um **comentário do ticket** (nota interna, fora do
 * chat).
 *
 * É o 2º uso de `features/chat/lib/note-actions.ts`: a regra é a mesma, mas
 * duplicada de propósito (a abstração espera o 3º uso). O banco não confere o
 * autor (grant por coluna, sem RPC, decisão 14 da Fase 4): quem confere é a
 * rota, com ESTES predicados, os mesmos com que a tela decide o menu. Regra
 * diferente nos dois lados dá item de menu que sempre falha, ou rota que aceita
 * o que a tela esconde.
 */

type CommentAuthorship = Pick<TicketComment, "author_user_id" | "deleted_at">;

/**
 * **Só o autor**, sem janela de tempo: o comentário nunca sai do nosso banco,
 * então não há versão antiga à mostra em outro lugar. Apagado é terminal (o
 * trigger responde COMMENT_DELETED). Comentário de integração
 * (`author_token_id`) ou de usuário removido não tem autor na equipe, e
 * `viewerId` nulo nunca autoriza.
 */
export function canEditComment(
  comment: CommentAuthorship,
  viewerId: string | null | undefined
): boolean {
  if (comment.deleted_at) return false;
  if (!viewerId) return false;
  return comment.author_user_id === viewerId;
}

/** Mesma regra da edição: o comentário é de quem escreveu. */
export function canDeleteComment(
  comment: CommentAuthorship,
  viewerId: string | null | undefined
): boolean {
  return canEditComment(comment, viewerId);
}

/**
 * Como assinar o comentário na timeline.
 *
 * - integração (`author_token_id`) → "Integração";
 * - sem autor nenhum → "Usuário removido": o INSERT exige um autor, então só a
 *   FK `on delete set null` deixa os dois nulos;
 * - o próprio autor → "Você";
 * - id sem nome na lista → `null`: a lista de usuários não carregou, e a
 *   timeline não inventa um nome.
 */
export function authorLabel(
  comment: Pick<TicketComment, "author_user_id" | "author_token_id">,
  names: ReadonlyMap<string, string>,
  viewerId: string | null | undefined
): string | null {
  if (comment.author_token_id) return "Integração";
  const authorId = comment.author_user_id;
  if (!authorId) return "Usuário removido";
  if (viewerId && authorId === viewerId) return "Você";
  return names.get(authorId) ?? null;
}
