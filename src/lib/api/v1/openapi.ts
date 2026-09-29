import { z } from "zod";

import {
  assignableUserSchema,
  listOf,
  productSchema,
  slaPolicySchema,
  ticketCategorySchema,
  ticketStatusSchema,
} from "@/lib/api/v1/catalog";
import { API_SCOPES } from "@/lib/api/v1/scopes";

// Contrato público da API v1, servido em GET /api/v1/openapi.json (D14). Os
// schemas daqui são a fonte: o teste das rotas valida a resposta real contra
// eles, para a documentação não se descolar do código. Cada PR da Fase 5
// acrescenta os seus caminhos.

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    allowed: z.array(z.string()).optional(),
    required: z.array(z.string()).optional(),
  }),
  request_id: z.string(),
});

export const healthSchema = z.object({
  ok: z.literal(true),
  data: z.object({ status: z.literal("ok"), api_version: z.literal("v1") }),
});

export const meSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    token: z.object({
      id: z.string(),
      name: z.string(),
      prefix: z.string(),
      scopes: z.array(z.string()),
      actor_type: z.enum(["ai", "api"]),
      rate_limit_per_min: z.number().int(),
      expires_at: z.string().nullable(),
    }),
  }),
});

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

/** Todo erro não listado (ex.: 500 `internal_error`) vem no mesmo envelope. */
const defaultError = errorResponse("Erro no envelope padrão, ex.: 500 `internal_error` (informe o `request_id`).");

/** Os erros de toda rota com token. */
const authErrors = {
  "401": errorResponse("Sem token, token inválido, revogado (`unauthorized`) ou vencido (`token_expired`)."),
  "403": errorResponse("O token não tem o escopo (`insufficient_scope`, com `required`)."),
  "429": errorResponse("Limite do token ou do IP (`rate_limited`, com `Retry-After`)."),
  default: defaultError,
};

/** GET de catálogo: lista em `data`, ou 503 `unavailable` quando a leitura falha (nunca `[]`). */
const catalogGet = (summary: string, schemaName: string) => ({
  get: {
    summary: `${summary} Escopo: \`catalog:read\`.`,
    responses: {
      "200": {
        description: "Lista completa (sem paginação).",
        content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } },
      },
      "503": errorResponse("Não foi possível ler agora (`unavailable`, com `Retry-After`)."),
      ...authErrors,
    },
  },
});

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "CRM Suporte — API v1",
      version: "1",
      description:
        "API para integradores e para o agente de IA. Autentique com `Authorization: Bearer <token>` " +
        "(gerado no CRM, com escopos). Toda resposta das operações documentadas traz `X-Request-Id`; " +
        "informe-o ao suporte (404 e 405 vêm do servidor, sem esse envelope). " +
        "POST de criação exige `Idempotency-Key`: repetir a mesma requisição devolve a mesma resposta " +
        "(`Idempotent-Replayed: true`); a mesma chave com outra requisição é 422 `idempotency_key_reused`.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: `Escopos: ${API_SCOPES.join(", ")}.` },
      },
      schemas: {
        Error: z.toJSONSchema(apiErrorSchema),
        Health: z.toJSONSchema(healthSchema),
        Me: z.toJSONSchema(meSchema),
        Products: z.toJSONSchema(listOf(productSchema)),
        TicketCategories: z.toJSONSchema(listOf(ticketCategorySchema)),
        TicketStatuses: z.toJSONSchema(listOf(ticketStatusSchema)),
        SlaPolicies: z.toJSONSchema(listOf(slaPolicySchema)),
        Users: z.toJSONSchema(listOf(assignableUserSchema)),
      },
    },
    paths: {
      "/health": {
        get: {
          summary: "Diagnóstico: a API responde. Público, sem token.",
          security: [],
          responses: {
            "200": {
              description: "No ar.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
            },
            "429": errorResponse("Muitas requisições deste IP."),
            default: defaultError,
          },
        },
      },
      "/me": {
        get: {
          summary: "O token que fez a chamada: nome, escopos, tipo (ai|api), limite e validade.",
          responses: {
            "200": {
              description: "Token válido.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Me" } } },
            },
            "401": errorResponse("Sem token, token inválido, revogado (`unauthorized`) ou vencido (`token_expired`)."),
            "429": errorResponse("Limite do token ou do IP (`rate_limited`, com `Retry-After`)."),
            default: defaultError,
          },
        },
      },
      "/products": catalogGet("Filas (produtos) ativas, por nome.", "Products"),
      "/ticket-categories": catalogGet(
        "Categorias que um ticket novo pode receber: gerais ou de fila ativa, com a mãe ativa.",
        "TicketCategories"
      ),
      "/ticket-statuses": catalogGet(
        "Status na ordem do quadro, com os destinos permitidos (`transitions`) de cada um.",
        "TicketStatuses"
      ),
      "/sla-policies": catalogGet(
        "Prioridades com os prazos de SLA, da menos urgente para a mais (`rank` crescente; maior = mais urgente).",
        "SlaPolicies"
      ),
      "/users": catalogGet("Quem pode receber ticket (ativos), por nome. Sem e-mail nem papel.", "Users"),
      "/openapi.json": {
        get: {
          summary: "Este documento. Público, sem token.",
          security: [],
          responses: {
            "200": { description: "OpenAPI 3.1." },
            "429": errorResponse("Muitas requisições deste IP."),
            default: defaultError,
          },
        },
      },
    },
  };
}
