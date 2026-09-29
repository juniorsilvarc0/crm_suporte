import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/v1/errors";

/** Sucesso da v1: `{ ok: true, data }`. */
export function apiOk<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true as const, data }, init);
}

/**
 * Leitura que falhou no banco: 503, nunca `[]`. Uma lista vazia diria "não há
 * status" ou "não há fila", e o integrador agiria em cima disso.
 */
export function unavailable(requestId: string, what: string) {
  return apiError(requestId, 503, "unavailable", `Não foi possível ler ${what} agora. Tente de novo.`, {}, {
    "Retry-After": "5",
  });
}
