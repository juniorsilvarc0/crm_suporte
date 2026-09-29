import { NextResponse } from "next/server";

// Envelope de erro da API v1 (docs/PLANO-IMPLANTACAO.md §C): o integrador lê
// `error.code` (estável, em inglês) e reporta o `request_id` ao suporte, que
// acha a chamada em integration_logs.

export type ApiErrorExtras = {
  /** Erros por campo (validação): caminho → mensagem. */
  fields?: Record<string, string>;
  /** Valores permitidos (ex.: transições de status). */
  allowed?: readonly string[];
  /** Escopos que faltaram. */
  required?: readonly string[];
};

export type ApiErrorBody = {
  ok: false;
  error: { code: string; message: string } & ApiErrorExtras;
  request_id: string;
};

export const REQUEST_ID_HEADER = "X-Request-Id";

export function apiError(
  requestId: string,
  status: number,
  code: string,
  message: string,
  extras: ApiErrorExtras = {},
  headers: Record<string, string> = {}
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { ok: false, error: { code, message, ...extras }, request_id: requestId },
    { status, headers: { [REQUEST_ID_HEADER]: requestId, ...headers } }
  );
}
