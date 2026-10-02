import { z } from "zod";

import { API_SCOPES } from "@/lib/api/v1/scopes";
import { APP_TIME_ZONE_OFFSET } from "@/lib/formatters/date";

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
export const PAST_EXPIRY_MESSAGE = "A validade precisa ser no futuro.";

/** A validade escolhida já passou (a mesma regra do `expiresAtSchema`). */
export function isPastExpiry(expiresAt: string | null, now = Date.now()): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now;
}

// Validade no passado criaria um token morto: é recusada. Sai sempre em UTC
// (Z): o Postgres recusa deslocamento acima de ±15:59, que o formato ISO aceita.
const expiresAtSchema = z.iso
  .datetime({ offset: true, error: "Data inválida." })
  .nullable()
  .refine((value) => !isPastExpiry(value), PAST_EXPIRY_MESSAGE)
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

/**
 * O formulário de edição do token (Integrações › API do CRM). Usa as MESMAS
 * regras de campo da rota; só a forma de entrada muda: o limite é digitado como
 * texto, e a validade é uma data (vazia = sem validade), que vale até o fim do
 * dia no fuso do app. O que sai daqui é o corpo do PATCH, que a rota valida de
 * novo com o `updateApiTokenSchema`.
 */
export const apiTokenEditFormSchema = z.object({
  name: nameSchema,
  scopes: scopesSchema,
  actor_type: actorTypeSchema,
  rate_limit_per_min: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, "Informe um número de 1 a 6000.")
    .transform(Number)
    .pipe(rateLimitSchema),
  // Sem a regra "no futuro" aqui: um token já vencido abre com a data antiga, e
  // salvar outro campo não pode esbarrar nela. O formulário aplica a regra só
  // quando a validade foi mexida (`isPastExpiry`), e a rota a aplica no PATCH.
  expires_on: z
    .union([z.literal(""), z.iso.date({ error: "Data inválida." })])
    .transform((value) =>
      value === "" ? null : new Date(`${value}T23:59:59${APP_TIME_ZONE_OFFSET}`).toISOString()
    ),
});


export type ApiTokenEditFormInput = z.input<typeof apiTokenEditFormSchema>;
export type ApiTokenEditFormOutput = z.output<typeof apiTokenEditFormSchema>;
