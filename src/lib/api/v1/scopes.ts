// Escopos da API v1 (docs/PLANO-FASE-5.md, decisão D4). Formato `recurso:acao`,
// o mesmo que o check de api_tokens.scopes aceita. `recurso:*` no token cobre
// toda ação do recurso, as de hoje e as que vierem.

export const API_SCOPES = [
  "context:read",
  "contacts:read",
  "contacts:write",
  "customers:read",
  "customers:write",
  "catalog:read",
  "tickets:read",
  "tickets:write",
  "comments:write",
  "attachments:read",
  "attachments:write",
  "conversations:read",
  "conversations:handoff",
  "messages:send",
  "notices:claim",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/**
 * Preset "IA de triagem" (D4): o que o agente precisa para triar, abrir e
 * conduzir o ticket e responder. Fora dele: `customers:write` (cadastro de
 * empresa é do analista) e `notices:claim` (Fase 6).
 */
export const AI_TRIAGE_PRESET: readonly ApiScope[] = [
  "context:read",
  "contacts:read",
  "contacts:write",
  "customers:read",
  "catalog:read",
  "tickets:read",
  "tickets:write",
  "comments:write",
  "attachments:write",
  "conversations:read",
  "messages:send",
  "conversations:handoff",
];

/** Limite do preset da IA (D5): acima do padrão de 120/min de api_tokens. */
export const AI_TRIAGE_RATE_LIMIT_PER_MIN = 300;

function resourceOf(scope: string): string {
  return scope.slice(0, scope.indexOf(":"));
}

/** O token cobre o escopo exigido? Exato, ou `recurso:*`. */
export function hasScope(tokenScopes: readonly string[], required: string): boolean {
  return tokenScopes.includes(required) || tokenScopes.includes(`${resourceOf(required)}:*`);
}

/** Os escopos exigidos que o token NÃO cobre (vazio = autorizado). */
export function missingScopes(
  tokenScopes: readonly string[],
  required: readonly string[]
): string[] {
  return required.filter((scope) => !hasScope(tokenScopes, scope));
}
