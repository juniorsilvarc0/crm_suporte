import { z } from "zod";

import { API_SCOPES } from "@/lib/api/v1/scopes";

const KNOWN_SCOPES = new Set<string>(API_SCOPES);
const SCOPE_RESOURCES = new Set(API_SCOPES.map((scope) => scope.slice(0, scope.indexOf(":"))));

/**
 * Escopo do catálogo da v1, ou `recurso:*` de um recurso do catálogo. O banco
 * só confere o formato; um escopo digitado errado seria aceito e não daria
 * acesso a nada — o erro aparece aqui, na hora de salvar.
 */
export function isKnownScope(scope: string): boolean {
  return KNOWN_SCOPES.has(scope) || (scope.endsWith(":*") && SCOPE_RESOURCES.has(scope.slice(0, -2)));
}

const nameSchema = z.string().trim().min(1, "Informe um nome.").max(60, "Máximo de 60 caracteres.");
const scopesSchema = z
  .array(z.string().refine(isKnownScope, "Escopo desconhecido."))
  .max(64, "No máximo 64 escopos.")
  .transform((scopes) => [...new Set(scopes)]);
const actorTypeSchema = z.enum(["ai", "api"], { error: "Tipo inválido." });
// Mesmos limites do check api_tokens_rate_limit_check.
const rateLimitSchema = z
  .number({ error: "Informe um número." })
  .int("Informe um número inteiro.")
  .min(1, "Mínimo de 1 por minuto.")
  .max(6000, "Máximo de 6000 por minuto.");
// Validade no passado criaria um token morto: é recusada. Sai sempre em UTC
// (Z): o Postgres recusa deslocamento acima de ±15:59, que o formato ISO aceita.
const expiresAtSchema = z.iso
  .datetime({ offset: true, error: "Data inválida." })
  .nullable()
  .refine((value) => value === null || Date.parse(value) > Date.now(), "A validade precisa ser no futuro.")
  .transform((value) => (value === null ? null : new Date(value).toISOString()));

export const createApiTokenSchema = z.object({
  name: nameSchema,
  // Sem escopo, o token nasce inerte (o banco também começa em '{}').
  scopes: scopesSchema.default([]),
  actor_type: actorTypeSchema.default("api"),
  rate_limit_per_min: rateLimitSchema.default(120),
  expires_at: expiresAtSchema.default(null),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

export const updateApiTokenSchema = z
  .object({
    name: nameSchema.optional(),
    scopes: scopesSchema.optional(),
    actor_type: actorTypeSchema.optional(),
    rate_limit_per_min: rateLimitSchema.optional(),
    expires_at: expiresAtSchema.optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), "Nada para alterar.");

export type UpdateApiTokenInput = z.infer<typeof updateApiTokenSchema>;
