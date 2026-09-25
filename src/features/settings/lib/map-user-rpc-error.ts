// Traduz os erros levantados pelas RPCs de gestão de usuários
// (raise exception 'TAG') em status HTTP + mensagem amigável, marcando o campo
// quando o erro é de um input específico.
export type MappedUserError = {
  status: number;
  message: string;
  field?: "email" | "password";
};

export function mapUserRpcError(rawMessage: string | undefined | null): MappedUserError {
  const message = rawMessage ?? "";

  if (message.includes("EMAIL_TAKEN")) {
    return { status: 409, message: "Já existe um usuário com este email.", field: "email" };
  }
  if (message.includes("WEAK_PASSWORD")) {
    return {
      status: 422,
      message: "A senha deve ter ao menos 8 caracteres.",
      field: "password",
    };
  }
  if (message.includes("SELF_DEACTIVATE")) {
    return { status: 400, message: "Você não pode desativar a si mesmo." };
  }
  if (message.includes("SELF_ROLE_CHANGE")) {
    return { status: 400, message: "Você não pode remover o próprio acesso ou papel." };
  }
  if (message.includes("SELF_DELETE")) {
    return { status: 400, message: "Você não pode excluir a própria conta." };
  }
  if (message.includes("LAST_ACTIVE_ADMIN")) {
    return { status: 409, message: "Deve haver ao menos um administrador ativo." };
  }
  if (message.includes("FORBIDDEN")) {
    return { status: 403, message: "Você não tem permissão para esta alteração." };
  }
  if (message.includes("UNAUTHORIZED")) {
    return { status: 401, message: "Sessão inválida." };
  }
  if (message.includes("LAST_ACTIVE_USER")) {
    return { status: 409, message: "Deve haver ao menos um usuário ativo." };
  }
  if (message.includes("USER_NOT_FOUND")) {
    return { status: 404, message: "Usuário não encontrado." };
  }
  if (message.includes("INVALID_INPUT")) {
    return { status: 400, message: "Revise os campos destacados." };
  }
  return { status: 500, message: "Não foi possível concluir a operação." };
}
