import { NextResponse } from "next/server";
import type { z } from "zod";

import { apiError } from "@/lib/api/v1/errors";

/** Sucesso da v1: `{ ok: true, data }`. */
export function apiOk<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json({ ok: true as const, data }, init);
}

/** Página de uma lista com cursor: `{ ok: true, data, meta: { next_cursor } }` (null = acabou). */
export function apiPage<T>(data: T[], nextCursor: string | null) {
  return NextResponse.json({ ok: true as const, data, meta: { next_cursor: nextCursor } });
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

/** 404 do recurso da rota. Id malformado também: para o integrador, ele não existe. */
export function notFound(requestId: string, message: string) {
  return apiError(requestId, 404, "not_found", message);
}

/**
 * Entrada que não passou no schema (query ou corpo): 400 `validation_error`,
 * uma mensagem por campo. Chave desconhecida vira erro no próprio nome dela:
 * `nome` no lugar de `name` não pode passar como "nada a alterar".
 */
export function invalidInput(requestId: string, error: z.ZodError) {
  // Sem protótipo: `constructor` ou `toString` na query são chaves como outras,
  // e o `??=` não pode achar que já existem.
  const fields: Record<string, string> = Object.create(null);
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields[key] ??= "Campo não aceito.";
      continue;
    }
    fields[issue.path.map(String).join(".") || "body"] ??= issue.message;
  }
  return apiError(requestId, 400, "validation_error", "Revise os campos.", { fields });
}
