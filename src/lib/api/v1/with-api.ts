import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordIntegrationLog } from "@/features/integrations/queries/record-integration-log";
import { apiError, REQUEST_ID_HEADER } from "@/lib/api/v1/errors";
import {
  beginIdempotency,
  canonicalJson,
  finishIdempotency,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_RE,
  releaseIdempotency,
  REPLAYED_HEADER,
  sha256Hex,
  sha256OfBlob,
} from "@/lib/api/v1/idempotency";
import { missingScopes, type ApiScope } from "@/lib/api/v1/scopes";
import { hashApiToken } from "@/lib/security/api-token";
import { clientKeyFromRequest, rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";

// Porta única da API v1 (docs/PLANO-FASE-5.md, PR 4). Toda rota de
// src/app/api/v1 exporta `withApi(...)` ou, só na lista pública do teste,
// `withPublicApi(...)`. Ordem, e por quê:
//   1. request_id — vai em toda resposta e no log;
//   2. limite por IP ANTES de tocar o banco: Bearer inválido em rajada não
//      vira uma consulta por tentativa;
//   3. Bearer → 1 SELECT por hash, só token não revogado; vencido é 401;
//   4. escopos (curinga `recurso:*`);
//   5. limite do token (rate_limit_per_min);
//   6. last_used_at no máximo 1×/min, sem esperar;
//   7. teto do corpo pelo Content-Length, ANTES de ler um byte;
//   8. Idempotency-Key, quando a rota exige: só aqui o corpo é lido, no tipo
//      que a rota declarou (JSON, ou multipart para anexo);
//   9. handler; exceção vira 500 com request_id;
//  10. log em integration_logs, SEM o corpo.
// Com 2 réplicas, os limites são por processo (aproximados, D5).

/** Teto por IP, acima de qualquer limite de token (o da IA é 300/min). */
export const API_IP_LIMIT_PER_MIN = 1200;
const WINDOW_MS = 60_000;
/** last_used_at é informativo: gravar a cada chamada seria um UPDATE por requisição. */
const LAST_USED_EVERY_MS = 60_000;
/**
 * 401 de token desconhecido não tem dono: vai ao log por amostra, por IP. Sem
 * isso, uma rajada anônima vira até 1.200 linhas/min que só a Fase 6 expurga.
 */
export const API_AUTH_FAIL_LOG_PER_MIN = 10;
/** Teto do corpo de uma rota que não declara outro: o JSON da v1 é pequeno. */
export const API_DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
/** `api_idempotency_keys.route` guarda o caminho concreto, com check de 512. */
const IDEMPOTENCY_PATH_MAX = 512;

/**
 * Registro, por identidade, das funções que withApi/withPublicApi devolvem. O
 * varredor da v1 (api-v1-guards.test.ts) exige que TODO método exportado por
 * uma rota esteja aqui: função declarada à mão, wrapper em volta do withApi ou
 * re-export ficam de fora e reprovam, qualquer que seja a forma do código.
 */
export const API_V1_HANDLERS = new WeakMap<object, "auth" | "public">();

type RouteParams = Record<string, string | string[] | undefined>;
type HandlerContext<P extends RouteParams> = { params: Promise<P> };
type Admin = SupabaseClient<Database>;

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  actorType: "ai" | "api";
  rateLimitPerMin: number;
  expiresAt: string | null;
};

export type ApiContext<P extends RouteParams> = {
  request: Request;
  params: P;
  requestId: string;
  supabase: Admin;
  token: ApiToken;
  /**
   * O multipart já lido (só em rota `body: "multipart"`). O corpo foi
   * consumido aqui: o handler usa ISTO, nunca `request.formData()`.
   */
  form: FormData | null;
};

export type PublicApiContext<P extends RouteParams> = {
  request: Request;
  params: P;
  requestId: string;
};

type Options = {
  /** Template da rota, para o log (ex.: "/api/v1/tickets/[id]"). */
  route: string;
  /** Todos exigidos. Vazio = qualquer token válido (ex.: /me). */
  scopes: readonly ApiScope[];
  /** POST de criação (D6): exige Idempotency-Key e repete a resposta. */
  idempotency?: "required";
  /**
   * O corpo que a rota idempotente aceita. `json` (padrão) ou `multipart`
   * (anexo). O outro tipo é 415 sem ler o corpo nem reservar a chave.
   */
  body?: "json" | "multipart";
  /** Teto do corpo em bytes (padrão: API_DEFAULT_MAX_BODY_BYTES). */
  maxBodyBytes?: number;
};

function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth || !/^bearer\s+/i.test(auth)) return null;
  const token = auth.replace(/^bearer\s+/i, "").trim();
  return token || null;
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function ipLimited(request: Request, requestId: string): Response | null {
  const limit = rateLimit(`api-ip:${clientKeyFromRequest(request)}`, API_IP_LIMIT_PER_MIN, WINDOW_MS);
  if (limit.ok) return null;
  return apiError(requestId, 429, "rate_limited", "Muitas requisições. Tente de novo em instantes.", {}, {
    "Retry-After": String(limit.retryAfter),
  });
}

/** Rota pública (só /health e /openapi.json, D14): sem token e sem banco. */
export function withPublicApi<P extends RouteParams = RouteParams>(
  _options: { route: string },
  handler: (ctx: PublicApiContext<P>) => Response | Promise<Response>
) {
  const publicRoute = async (request: Request, context: HandlerContext<P>): Promise<Response> => {
    const requestId = randomUUID();
    const limited = ipLimited(request, requestId);
    if (limited) return limited;
    try {
      const params = ((await context?.params) ?? {}) as P;
      return withRequestId(await handler({ request, params, requestId }), requestId);
    } catch (error) {
      console.error(`[api/v1] ${requestId}`, error);
      return apiError(requestId, 500, "internal_error", "Erro interno. Informe o request_id ao suporte.");
    }
  };
  API_V1_HANDLERS.set(publicRoute, "public");
  return publicRoute;
}

export function withApi<P extends RouteParams = RouteParams>(
  options: Options,
  handler: (ctx: ApiContext<P>) => Response | Promise<Response>
) {
  // Quem lê o multipart é a idempotência: sem ela, ninguém preencheria ctx.form.
  if (options.body === "multipart" && options.idempotency !== "required") {
    throw new Error(`withApi(${options.route}): body "multipart" exige idempotency "required"`);
  }
  const maxBodyBytes = options.maxBodyBytes ?? API_DEFAULT_MAX_BODY_BYTES;

  const apiRoute = async (request: Request, context: HandlerContext<P>): Promise<Response> => {
    const startedAt = Date.now();
    const requestId = randomUUID();

    const limited = ipLimited(request, requestId);
    if (limited) return limited;

    const bearer = bearerToken(request);
    if (!bearer) {
      // Sem credencial não se toca o banco (nem para logar).
      return apiError(requestId, 401, "unauthorized", "Envie Authorization: Bearer <token>.");
    }

    let supabase: Admin;
    try {
      supabase = createSupabaseAdminClient();
    } catch (error) {
      console.error(`[api/v1] ${requestId}`, error);
      return apiError(requestId, 500, "internal_error", "Erro interno. Informe o request_id ao suporte.");
    }

    let tokenId: string | null = null;
    const finish = (response: Response): Response => {
      void recordIntegrationLog(supabase, {
        provider: "api_v1",
        direction: "inbound",
        action: request.method,
        status: response.status < 400 ? "ok" : "error",
        apiTokenId: tokenId,
        requestId,
        route: options.route,
        httpStatus: response.status,
        latencyMs: Date.now() - startedAt,
      }).catch(() => undefined);
      return withRequestId(response, requestId);
    };

    try {
      const { data: row, error } = await supabase
        .from("api_tokens")
        .select("id, name, token_prefix, scopes, actor_type, rate_limit_per_min, expires_at, last_used_at")
        .eq("token_hash", hashApiToken(bearer))
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error(`api_tokens: ${error.message}`);
      if (!row) {
        const denied = apiError(requestId, 401, "unauthorized", "Token inválido ou revogado.");
        const sampled = rateLimit(
          `api-authfail-log:${clientKeyFromRequest(request)}`,
          API_AUTH_FAIL_LOG_PER_MIN,
          WINDOW_MS
        );
        return sampled.ok ? finish(denied) : withRequestId(denied, requestId);
      }
      tokenId = row.id;
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
        return finish(apiError(requestId, 401, "token_expired", "Token vencido. Gere outro no CRM."));
      }

      const token: ApiToken = {
        id: row.id,
        name: row.name,
        prefix: row.token_prefix,
        scopes: row.scopes,
        actorType: row.actor_type === "ai" ? "ai" : "api",
        rateLimitPerMin: row.rate_limit_per_min,
        expiresAt: row.expires_at,
      };

      const missing = missingScopes(token.scopes, options.scopes);
      if (missing.length > 0) {
        return finish(
          apiError(requestId, 403, "insufficient_scope", "O token não tem os escopos desta rota.", {
            required: missing,
          })
        );
      }

      const limit = rateLimit(`api-token:${token.id}`, token.rateLimitPerMin, WINDOW_MS);
      if (!limit.ok) {
        return finish(
          apiError(requestId, 429, "rate_limited", "Limite de requisições do token atingido.", {}, {
            "Retry-After": String(limit.retryAfter),
          })
        );
      }

      if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > LAST_USED_EVERY_MS) {
        // `.then()` obrigatório: o builder do supabase-js é preguiçoso, e sem
        // consumidor o UPDATE nunca sai (o bug documentado em verify-webhook).
        void supabase
          .from("api_tokens")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", token.id)
          .then(
            () => undefined,
            () => undefined
          );
      }

      // Antes de ler: um corpo declarado acima do teto não é lido, parseado
      // nem hasheado. Sem Content-Length (chunked), a leitura tem o mesmo teto.
      if (Number(request.headers.get("content-length")) > maxBodyBytes) {
        return finish(tooLarge(requestId, maxBodyBytes));
      }

      const params = ((await context?.params) ?? {}) as P;
      const run = (form: FormData | null) => handler({ request, params, requestId, supabase, token, form });

      if (options.idempotency !== "required") {
        return finish(await run(null));
      }
      return finish(
        await runIdempotent(
          { supabase, request, requestId, tokenId: token.id, accepts: options.body ?? "json", maxBodyBytes },
          run
        )
      );
    } catch (error) {
      console.error(`[api/v1] ${requestId}`, error);
      return finish(apiError(requestId, 500, "internal_error", "Erro interno. Informe o request_id ao suporte."));
    }
  };
  API_V1_HANDLERS.set(apiRoute, "auth");
  return apiRoute;
}

function tooLarge(requestId: string, maxBodyBytes: number) {
  const megabytes = Math.floor(maxBodyBytes / (1024 * 1024));
  const limit = megabytes >= 1 ? `${megabytes} MB` : `${Math.floor(maxBodyBytes / 1024)} KB`;
  return apiError(requestId, 413, "payload_too_large", `Corpo acima do limite de ${limit}.`);
}

/** Lê o corpo como texto, parando no teto. `null` = passou do teto. */
async function readTextCapped(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.clone().body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Sem await: o cancelamento de uma metade do clone só resolve quando a
      // outra (o corpo original, que ninguém vai ler) também é cancelada.
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type ReadBody =
  | { hash: string; form: FormData | null }
  | { error: "unsupported" | "too_large" | "invalid_json" | "invalid_multipart" };

/**
 * Lê o corpo no tipo que a rota aceita e devolve o hash canônico: JSON com as
 * chaves em ordem, ou (anexo) as partes do multipart. O multipart não é
 * hasheado cru: o boundary muda a cada envio, e o mesmo arquivo reenviado
 * seria "outra requisição". Cada parte entra pelo nome, na ordem, com o texto
 * ou com nome, tipo, tamanho e sha256 do arquivo.
 *
 * O multipart é lido UMA vez (sem clone): o FormData volta para o handler.
 */
async function readBody(request: Request, accepts: "json" | "multipart", maxBodyBytes: number): Promise<ReadBody> {
  const type = request.headers.get("content-type") ?? "";

  if (accepts === "multipart") {
    if (!/^multipart\/form-data\b/i.test(type)) return { error: "unsupported" };
    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      // O parser lança TypeError no multipart malformado. Outra coisa (ex.:
      // falta de memória) é falha nossa, não entrada inválida.
      if (error instanceof TypeError) return { error: "invalid_multipart" };
      throw error;
    }
    const parts: unknown[] = [];
    for (const [name, value] of form.entries()) {
      parts.push(
        typeof value === "string"
          ? { name, value }
          : { name, file: { name: value.name, type: value.type, size: value.size, sha256: await sha256OfBlob(value) } }
      );
    }
    return { hash: sha256Hex(canonicalJson(parts)), form };
  }

  // Tipo declarado que não é JSON é 415 SEM ler o corpo. Sem tipo (ou com o
  // corpo declarado vazio), só o corpo vazio passa.
  const isJson = /^application\/json\b/i.test(type);
  if (!isJson && type !== "" && request.headers.get("content-length") !== "0") return { error: "unsupported" };
  const text = await readTextCapped(request, maxBodyBytes);
  if (text === null) return { error: "too_large" };
  if (text.trim() === "") return { hash: sha256Hex(""), form: null };
  if (!isJson) return { error: "unsupported" };
  try {
    return { hash: sha256Hex(canonicalJson(JSON.parse(text))), form: null };
  } catch {
    return { error: "invalid_json" };
  }
}

function isKeyReused(body: Json): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const error = body.error;
  return error != null && typeof error === "object" && !Array.isArray(error) && error.code === "idempotency_key_reused";
}

type IdempotentCall = {
  supabase: Admin;
  request: Request;
  requestId: string;
  tokenId: string;
  accepts: "json" | "multipart";
  maxBodyBytes: number;
};

async function runIdempotent(
  { supabase, request, requestId, tokenId, accepts, maxBodyBytes }: IdempotentCall,
  run: (form: FormData | null) => Response | Promise<Response>
): Promise<Response> {
  const key = request.headers.get(IDEMPOTENCY_HEADER);
  if (!key) {
    return apiError(requestId, 400, "idempotency_key_required", `Envie o header ${IDEMPOTENCY_HEADER}.`);
  }
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    return apiError(
      requestId,
      400,
      "invalid_idempotency_key",
      `${IDEMPOTENCY_HEADER}: 8 a 200 caracteres entre letras, dígitos e . _ : -`
    );
  }

  // Caminho CONCRETO, sem query: a mesma chave em outro recurso é reuso. Um
  // caminho que nem cabe na coluna não é de recurso nenhum.
  const path = new URL(request.url).pathname;
  if (path.length > IDEMPOTENCY_PATH_MAX) {
    return apiError(requestId, 404, "not_found", "Recurso não encontrado.");
  }

  const read = await readBody(request, accepts, maxBodyBytes);
  if ("error" in read) {
    switch (read.error) {
      case "unsupported":
        return apiError(
          requestId,
          415,
          "unsupported_media_type",
          accepts === "multipart"
            ? "Envie o arquivo em multipart/form-data."
            : "Envie o corpo em JSON (Content-Type: application/json)."
        );
      case "too_large":
        return tooLarge(requestId, maxBodyBytes);
      case "invalid_multipart":
        return apiError(
          requestId,
          400,
          "invalid_multipart",
          'multipart/form-data inválido. No Content-Disposition, use name="file" e filename="..." entre aspas, sem filename*.'
        );
      case "invalid_json":
        return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    }
  }

  const begun = await beginIdempotency(supabase, {
    tokenId,
    key,
    method: request.method,
    path,
    requestHash: read.hash,
  });

  if (begun.outcome === "replay") {
    return NextResponse.json(begun.body, { status: begun.status, headers: { [REPLAYED_HEADER]: "true" } });
  }
  if (begun.outcome === "reused") {
    return apiError(
      requestId,
      422,
      "idempotency_key_reused",
      "Esta Idempotency-Key já foi usada com outra requisição."
    );
  }
  if (begun.outcome === "in_progress") {
    return apiError(
      requestId,
      409,
      "idempotency_in_progress",
      "Uma requisição com esta Idempotency-Key ainda está em andamento."
    );
  }

  const attempt = { tokenId, key, attemptId: begun.attemptId };
  let response: Response;
  try {
    response = await run(read.form);
  } catch (error) {
    await releaseIdempotency(supabase, attempt).catch(() => undefined);
    throw error;
  }

  // Guarda só 2xx e 422 com corpo JSON (D6); o resto libera a chave.
  const storable = (response.status >= 200 && response.status < 300) || response.status === 422;
  let body: Json | undefined;
  if (storable) {
    try {
      body = (await response.clone().json()) as Json;
    } catch {
      body = undefined;
    }
  }
  // O handler que responde "esta chave é de outra requisição" não fica com a
  // chave: guardada, a recusa faria a requisição dona passar a ser a reusada.
  if (body === undefined || isKeyReused(body)) {
    await releaseIdempotency(supabase, attempt).catch((error) =>
      console.error(`[api/v1] ${requestId} release`, error)
    );
    return response;
  }
  const stored = await finishIdempotency(supabase, { ...attempt, status: response.status, body }).catch(
    (error) => {
      console.error(`[api/v1] ${requestId} finish`, error);
      return false;
    }
  );
  if (!stored) console.warn(`[api/v1] ${requestId}: resposta não guardada (lease perdida)`);
  return response;
}
