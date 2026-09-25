/**
 * Linha de um evento `postgres_changes` que a policy liberou, ou null.
 *
 * Negado pela RLS, o evento chega com `errors: ["Error 401: Unauthorized"]` e
 * `new: {}` — e `{}` é truthy: sem este filtro a tela receberia uma "mensagem"
 * vazia.
 */
export function deliveredRow<T extends object>(payload: {
  new: T;
  errors?: string[] | null;
}): T | null {
  if (payload.errors?.length) return null;
  return payload.new && Object.keys(payload.new).length > 0 ? payload.new : null;
}
