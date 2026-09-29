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
//   7. Idempotency-Key, quando a rota exige;
//   8. handler; exceção vira 500 com request_id;
//   9. log em integration_logs, SEM o corpo.
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

      const params = ((await context?.params) ?? {}) as P;
      const run = () => handler({ request, params, requestId, supabase, token });

      if (options.idempotency !== "required") {
        return finish(await run());
      }
      return finish(await runIdempotent(supabase, request, requestId, token.id, run));
    } catch (error) {
      console.error(`[api/v1] ${requestId}`, error);
      return finish(apiError(requestId, 500, "internal_error", "Erro interno. Informe o request_id ao suporte."));
    }
  };
  API_V1_HANDLERS.set(apiRoute, "auth");
  return apiRoute;
}

/** Hash do corpo canônico. Só JSON (ou vazio): multipart é decisão do PR 8. */
async function requestHash(request: Request): Promise<{ hash: string } | { error: Response }> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.clone().text();
  if (text.trim() === "") return { hash: sha256Hex("") };
  if (!/^application\/json\b/i.test(type)) {
    return { error: new Response(null, { status: 415 }) };
  }
  try {
    return { hash: sha256Hex(canonicalJson(JSON.parse(text))) };
  } catch {
    return { error: new Response(null, { status: 400 }) };
  }
}

async function runIdempotent(
  supabase: Admin,
  request: Request,
  requestId: string,
  tokenId: string,
  run: () => Response | Promise<Response>
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

  const hashed = await requestHash(request);
  if ("error" in hashed) {
    return hashed.error.status === 415
      ? apiError(requestId, 415, "unsupported_media_type", "Envie o corpo em JSON (Content-Type: application/json).")
      : apiError(requestId, 400, "invalid_json", "JSON inválido.");
  }

  const begun = await beginIdempotency(supabase, {
    tokenId,
    key,
    method: request.method,
    // Caminho CONCRETO, sem query: a mesma chave em outro recurso é reuso.
    path: new URL(request.url).pathname,
    requestHash: hashed.hash,
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
    response = await run();
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
  if (body === undefined) {
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
