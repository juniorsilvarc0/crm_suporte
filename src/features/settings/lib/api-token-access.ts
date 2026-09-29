import type { ApiTokenListItem } from "@/features/settings/types";
import { AI_TRIAGE_PRESET, AI_TRIAGE_RATE_LIMIT_PER_MIN } from "@/lib/api/v1/scopes";

// Neutro (sem módulo de servidor): usado pela query, pelas rotas de tokens e
// pela tela.

/** Colunas da lista de tokens. NUNCA inclui token_hash. */
export const API_TOKEN_LIST_COLUMNS =
  "id, name, token_prefix, scopes, actor_type, rate_limit_per_min, expires_at, created_at, last_used_at, revoked_at";

/** Padrão de api_tokens.rate_limit_per_min. */
export const DEFAULT_TOKEN_RATE_LIMIT_PER_MIN = 120;

type ApiTokenRow = Omit<ApiTokenListItem, "actor_type"> & { actor_type: string };

/**
 * Campo a campo, nunca `...row`: se um dia a consulta trouxer mais colunas
 * (um `select("*")`), o token_hash não vai junto para a tela nem para o JSON.
 */
export function toApiTokenListItem(row: ApiTokenRow): ApiTokenListItem {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    scopes: row.scopes,
    actor_type: row.actor_type === "ai" ? "ai" : "api",
    rate_limit_per_min: row.rate_limit_per_min,
    expires_at: row.expires_at,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

export type TokenAccessPreset = "none" | "ai_triage";

export const TOKEN_ACCESS_OPTIONS: ReadonlyArray<{ value: TokenAccessPreset; label: string }> = [
  { value: "none", label: "Sem acesso — definir escopos depois" },
  { value: "ai_triage", label: "IA de triagem — contexto, tickets e resposta no chat" },
];

/** O que o preset grava no token (D4 e D5 do plano da Fase 5). */
export function accessPresetFields(preset: TokenAccessPreset) {
  return preset === "ai_triage"
    ? {
        scopes: [...AI_TRIAGE_PRESET] as string[],
        actor_type: "ai" as const,
        rate_limit_per_min: AI_TRIAGE_RATE_LIMIT_PER_MIN,
      }
    : { scopes: [] as string[], actor_type: "api" as const, rate_limit_per_min: DEFAULT_TOKEN_RATE_LIMIT_PER_MIN };
}

/** Rótulo curto do acesso, para a lista. */
export function describeTokenAccess(token: Pick<ApiTokenListItem, "scopes" | "actor_type">): string {
  if (token.scopes.length === 0) return "Sem escopo";
  const preset = new Set<string>(AI_TRIAGE_PRESET);
  const isAiTriage =
    token.actor_type === "ai" && token.scopes.length === preset.size && token.scopes.every((scope) => preset.has(scope));
  if (isAiTriage) return "IA de triagem";
  return `${token.scopes.length} ${token.scopes.length === 1 ? "escopo" : "escopos"}`;
}

export function isTokenExpired(token: Pick<ApiTokenListItem, "expires_at">, now = Date.now()): boolean {
  return token.expires_at !== null && Date.parse(token.expires_at) <= now;
}

export type TokenStatus = "active" | "expired" | "revoked";

/** Um status só para o filtro, o selo e o esmaecimento da linha. */
export function tokenStatus(token: Pick<ApiTokenListItem, "revoked_at" | "expires_at">, now = Date.now()): TokenStatus {
  if (token.revoked_at) return "revoked";
  return isTokenExpired(token, now) ? "expired" : "active";
}
