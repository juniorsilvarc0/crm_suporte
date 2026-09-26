import { NextResponse } from "next/server";

import type { TicketError, TicketErrorBody } from "@/features/tickets/types";

type DatabaseErrorLike = { message?: string | null; code?: string | null };

/**
 * O corpo de erro de negócio, sem nada do banco. Exportado para a rota que
 * acrescenta um campo antes de responder (ex.: o nome de quem já está com o
 * ticket no `already_assigned`, ou o item existente no `duplicate`).
 */
export function ticketErrorBody(error: TicketError): TicketErrorBody {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    errors: error.field ? { [error.field]: [error.message] } : undefined,
    allowed: error.allowed,
    current: error.current,
    current_version: error.currentVersion,
    assigned_to_user_id: error.assignedToUserId,
  };
}

/**
 * Resposta de erro padrão das rotas de ticket: o corpo de ticketErrorBody e o
 * log do 500 (bug ou falha do banco) com o contexto da rota. `cause` é o erro
 * cru do banco, quando a rota o tem (consulta direta): entra só no log, e
 * `error.message` do banco nunca vai para o cliente.
 */
export function ticketErrorResponse(
  route: string,
  error: TicketError,
  cause?: DatabaseErrorLike | null
) {
  if (error.status >= 500) {
    console.error(route, cause?.code ?? error.code, cause?.message ?? error.message);
  }
  return NextResponse.json(ticketErrorBody(error), { status: error.status });
}
