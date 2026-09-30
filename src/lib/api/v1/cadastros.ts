import { z } from "zod";

import { CONTRACT_STATUSES, isContractStatus } from "@/features/contracts/lib/contract-status";
import type { ContractView } from "@/features/contracts/types";
import { isValidCnpj, normalizeCnpj } from "@/lib/formatters/cnpj";
import { normalizePhone } from "@/lib/formatters/phone";
import { searchTokens } from "@/lib/formatters/search-text";
import { UUID_RE } from "@/lib/validation/uuid";
import { listQueryShape } from "@/lib/api/v1/cursor";

// Empresas e contatos da API v1 (PR 6b do docs/PLANO-FASE-5.md). Como em
// catalog.ts: DTO campo a campo, em snake_case, e os schemas alimentam o
// OpenAPI e os testes das rotas. `search_name`, avatar e `anonymized_at` não
// saem; do contrato, nem valor nem dia de vencimento.

// ─── Respostas ───────────────────────────────────────────────────────────────

export const contactSchema = z.strictObject({
  id: z.string(),
  name: z.string().nullable(),
  /** Como chegou (ex.: com o DDI 55). */
  phone: z.string(),
  /** A identidade: só dígitos, sem o DDI 55. É por ela que `?phone=` procura. */
  normalized_phone: z.string(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  source: z.string().describe("Por onde entrou: whatsapp, indicacao, manual ou api."),
  customer_id: z.string().nullable(),
  last_message_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const customerSchema = z.strictObject({
  id: z.string(),
  legal_name: z.string(),
  trade_name: z.string().nullable(),
  /** Sem máscara, em caixa alta (aceita o CNPJ alfanumérico). */
  cnpj: z.string().nullable(),
  contract_status: z
    .enum(CONTRACT_STATUSES)
    .nullable()
    .describe("Selo do contrato: o vigente, senão o último encerrado; null = nunca teve contrato."),
  notes: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const contractSchema = z.strictObject({
  id: z.string(),
  status: z.enum(CONTRACT_STATUSES),
  starts_on: z.string(),
  ends_on: z.string().nullable(),
  plan: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
  products: z.array(z.strictObject({ id: z.string(), name: z.string() })),
});

export const itemOf = <T extends z.ZodType>(item: T) => z.strictObject({ ok: z.literal(true), data: item });
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    ok: z.literal(true),
    data: z.array(item),
    meta: z.strictObject({ next_cursor: z.string().nullable() }),
  });

// Colunas explícitas: o que não está aqui não sai do banco.
export const CONTACT_API_SELECT =
  "id, name, phone, normalized_phone, email, notes, source, customer_id, last_message_at, archived_at, created_at, updated_at";
export const CUSTOMER_API_SELECT =
  "id, legal_name, trade_name, cnpj, contract_status, notes, archived_at, created_at, updated_at";

type ContactRow = z.infer<typeof contactSchema>;
type CustomerRow = Omit<z.infer<typeof customerSchema>, "contract_status"> & { contract_status: string | null };

export function toApiContact(row: ContactRow): z.infer<typeof contactSchema> {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    normalized_phone: row.normalized_phone,
    email: row.email,
    notes: row.notes,
    source: row.source,
    customer_id: row.customer_id,
    last_message_at: row.last_message_at,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Selo que o app não conhece vira `null`, como em toCustomerSummary. */
export function toApiCustomer(row: CustomerRow): z.infer<typeof customerSchema> {
  return {
    id: row.id,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    cnpj: row.cnpj,
    contract_status: isContractStatus(row.contract_status) ? row.contract_status : null,
    notes: row.notes,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Plano e filas só com id e nome: a cor e o arquivamento são da tela. */
export function toApiContract(view: ContractView): z.infer<typeof contractSchema> {
  return {
    id: view.id,
    status: view.status,
    starts_on: view.starts_on,
    ends_on: view.ends_on,
    plan: view.plan ? { id: view.plan.id, name: view.plan.name } : null,
    products: view.products.map((product) => ({ id: product.id, name: product.name })),
  };
}

// ─── Entradas ────────────────────────────────────────────────────────────────

const PHONE_MESSAGE = "Telefone com DDD: 10 a 15 dígitos.";
const uuidParam = (message: string) => z.string({ error: message }).regex(UUID_RE, { error: message });

/**
 * Telefone da entrada, só os dígitos (DDI incluso, como o WhatsApp manda):
 * máscara não vai para o banco. Válido = a identidade normalizada (a regra da
 * RPC, sem o DDI 55) tem de 10 a 15 dígitos.
 */
const phoneDigits = z
  .string({ error: PHONE_MESSAGE })
  .max(30, { error: PHONE_MESSAGE })
  .describe("Com DDD; DDI 55 e máscara são aceitos. Sem o 55, 10 a 15 dígitos.")
  .transform((value) => value.replace(/\D/g, ""))
  .refine((digits) => /^\d{10,15}$/.test(normalizePhone(digits)), { error: PHONE_MESSAGE });

/** O mesmo teto de searchTokens, que corta o termo aí. */
const MAX_Q_LENGTH = 100;
/**
 * `q` que não sobra nenhum token (uma letra só, só pontuação) é 400: sem
 * token, nenhum filtro se aplicaria, e a base inteira voltaria como se fosse
 * o resultado da busca. Vazio (`q=`) é "sem busca".
 */
const searchQuery = z
  .string()
  .trim()
  .max(MAX_Q_LENGTH, { error: `No máximo ${MAX_Q_LENGTH} caracteres.` })
  .refine((q) => q === "" || searchTokens(q).length > 0, {
    error: "Use ao menos um termo de 2 ou mais letras ou dígitos.",
  })
  .optional();

/** Telefone de BUSCA: a identidade normalizada, para igualdade exata (alias incluso), sem nono dígito. */
export const phoneLookup = phoneDigits.transform((digits) => normalizePhone(digits));

export const contactListQuerySchema = z.strictObject({
  ...listQueryShape,
  /** Busca pelo nome (tokens, sem acento). */
  q: searchQuery,
  phone: phoneLookup.optional(),
  customer_id: uuidParam("Empresa inválida.").optional(),
});

export const customerListQuerySchema = z.strictObject({
  ...listQueryShape,
  /** Nome fantasia, razão social ou CNPJ (tokens, sem acento). */
  q: searchQuery,
  cnpj: z
    .string({ error: "CNPJ inválido." })
    .max(30, { error: "CNPJ inválido." })
    .transform((value) => normalizeCnpj(value))
    .refine((cnpj) => isValidCnpj(cnpj), { error: "CNPJ inválido: confira os dígitos verificadores." })
    .optional(),
});

/**
 * Texto livre que o Postgres guarda: o JSON aceita NUL (\u0000) e surrogate
 * solto, o `text` do banco não, e a gravação viraria 500.
 */
const storableText = (value: string) => !value.includes("\u0000") && value.isWellFormed();

const NAME_MESSAGE = "Nome de 1 a 120 caracteres, ou null.";
const name = z
  .string({ error: NAME_MESSAGE })
  .trim()
  .min(1, { error: NAME_MESSAGE })
  .max(120, { error: NAME_MESSAGE })
  .refine(storableText, { error: "Nome com caractere inválido." })
  .nullable()
  .optional();

const BODY_MESSAGE = "Envie um objeto JSON.";

/**
 * POST /contacts: acha a pessoa pelo telefone ou a cria. O nome só preenche
 * um nome VAZIO; renomear é pelo PATCH (decisão do dono, 2026-09-29).
 */
export const createContactSchema = z.strictObject({ phone: phoneDigits, name }, { error: BODY_MESSAGE });

/**
 * PATCH /contacts/{id}: só o que o banco deixa editar. Ausente não mexe; `null`
 * limpa. `phone` a rota recusa antes (422 `phone_immutable`).
 */
export const updateContactSchema = z.strictObject(
  {
    name,
    email: z
      .email({ error: "E-mail inválido." })
      .max(254, { error: "E-mail inválido." })
      .nullable()
      .optional(),
    notes: z
      .string({ error: "Observações de 1 a 2000 caracteres, ou null." })
      .trim()
      .min(1, { error: "Observações de 1 a 2000 caracteres, ou null." })
      .max(2000, { error: "Observações de 1 a 2000 caracteres, ou null." })
      .refine(storableText, { error: "Observações com caractere inválido." })
      .nullable()
      .optional(),
    customer_id: uuidParam("Empresa inválida.").nullable().optional(),
  },
  { error: BODY_MESSAGE }
);
