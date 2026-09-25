import { NextResponse } from "next/server";

import {
  mapCadastroError,
  type MappedCadastroError,
} from "@/features/customers/lib/map-cadastro-error";

type DatabaseErrorLike = { message?: string | null; code?: string | null };

/**
 * Resposta de erro padrão das rotas de cadastro: mensagem amigável, o campo
 * marcado em `errors` quando o erro é de um input, e log do 500 (bug ou falha
 * do banco) — `error.message` nunca vai para o cliente.
 *
 * `mapped` entra quando a rota já mapeou para decidir outra coisa antes
 * (ex.: 409 que devolve o item existente).
 */
export function cadastroErrorResponse(
  route: string,
  error: DatabaseErrorLike,
  mapped: MappedCadastroError = mapCadastroError(error)
) {
  if (mapped.status >= 500) console.error(route, error.message);
  return NextResponse.json(
    {
      ok: false,
      message: mapped.message,
      errors: mapped.field ? { [mapped.field]: [mapped.message] } : undefined,
    },
    { status: mapped.status }
  );
}
