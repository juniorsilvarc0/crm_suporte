import { z } from "zod";

import {
  contactSchema,
  contractSchema,
  createContactSchema,
  customerSchema,
  itemOf,
  pageOf,
  updateContactSchema,
} from "@/lib/api/v1/cadastros";
import {
  assignableUserSchema,
  listOf,
  productSchema,
  slaPolicySchema,
  ticketCategorySchema,
  ticketStatusSchema,
} from "@/lib/api/v1/catalog";
import { triageContextSchema } from "@/lib/api/v1/context";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/api/v1/cursor";
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

const json = (schemaName: string) => ({
  "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } },
});

const unavailableError = errorResponse("Não foi possível ler agora (`unavailable`, com `Retry-After`).");
const validationError = errorResponse("Parâmetro ou campo inválido (`validation_error`, com `fields`).");
const notFoundError = errorResponse("Não existe, ou o id não é um UUID (`not_found`).");

const idParam = (what: string) => ({
  name: "id",
  in: "path",
  required: true,
  description: `UUID ${what}.`,
  schema: { type: "string", format: "uuid" },
});

const queryParam = (name: string, description: string, schema: Record<string, unknown> = { type: "string" }) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

/** Os parâmetros de toda lista com cursor (cursor.ts). */
const listParams = [
  queryParam(
    "q",
    "Busca por texto, sem acento nem caixa (até 100 caracteres). Cada termo de 2+ letras ou dígitos precisa " +
      "casar; só os 5 primeiros termos contam. Sem nenhum termo válido (ex.: uma letra só) é 400."
  ),
  queryParam(
    "updated_since",
    "Só o que mudou a partir deste instante (ISO 8601 com fuso). Para sincronizar, repita com o maior " +
      "`updated_at` visto menos uma folga (ex.: 5 min) e deduplique por `id`.",
    { type: "string", format: "date-time" }
  ),
  queryParam("include_archived", "Inclui os arquivados (`archived_at` preenchido).", {
    type: "boolean",
    default: false,
  }),
  queryParam("cursor", "O `meta.next_cursor` da página anterior. Opaco: não monte à mão."),
  queryParam("limit", "Itens por página.", {
    type: "integer",
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  }),
];

const PAGE_DESCRIPTION =
  "Página em ordem de `updated_at` crescente (desempate por `id`). `meta.next_cursor: null` = acabou. " +
  "`updated_at` não é estritamente monotônico: a mesma linha pode reaparecer numa página seguinte.";

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "CRM Suporte — API v1",
      version: "1",
      description:
        "API para integradores e para o agente de IA. Autentique com `Authorization: Bearer <token>` " +
        "(gerado no CRM, com escopos). Toda resposta das operações documentadas traz `X-Request-Id`; " +
        "informe-o ao suporte. 404 de recurso inexistente vem no envelope (`not_found`); 404 de caminho " +
        "inexistente e 405 vêm do servidor, sem ele. " +
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
        Contact: z.toJSONSchema(itemOf(contactSchema)),
        ContactPage: z.toJSONSchema(pageOf(contactSchema)),
        ContactCreate: z.toJSONSchema(createContactSchema, { io: "input" }),
        ContactUpdate: z.toJSONSchema(updateContactSchema, { io: "input" }),
        Customer: z.toJSONSchema(itemOf(customerSchema)),
        CustomerPage: z.toJSONSchema(pageOf(customerSchema)),
        Contract: z.toJSONSchema(itemOf(contractSchema.nullable())),
        TriageContext: z.toJSONSchema(itemOf(triageContextSchema)),
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
      "/context": {
        get: {
          summary:
            "Tudo o que a IA precisa para triar, numa ida só: contato, empresa, contrato e alerta, a conversa mais " +
            "recente, os tickets abertos dela com as transições permitidas, os últimos tickets encerrados, as " +
            "últimas 20 mensagens (sem notas internas) e `ai_may_reply`. Só lê: não cria contato nem marca como " +
            "lido. Escopo: `context:read`.",
          parameters: [
            {
              name: "phone",
              in: "query",
              required: true,
              description:
                "Telefone com DDD, com ou sem DDI 55 e máscara. Igualdade exata com a pessoa (números antigos " +
                "inclusos), sem tolerância ao nono dígito.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "O contexto. Telefone desconhecido também é 200, com `contact: null` e o resto vazio.",
              content: json("TriageContext"),
            },
            "400": validationError,
            "503": errorResponse(
              "Alguma leitura falhou (`unavailable`, com `Retry-After`): o contexto nunca sai pela metade."
            ),
            ...authErrors,
          },
        },
      },
      "/contacts": {
        get: {
          summary: "Contatos, com cursor. Anonimizado nunca sai. Escopo: `contacts:read`.",
          parameters: [
            ...listParams,
            queryParam(
              "phone",
              "Igualdade exata com o telefone da pessoa (números antigos inclusos), com ou sem DDI 55 e máscara. " +
                "Sem tolerância ao nono dígito."
            ),
            queryParam("customer_id", "Só os contatos desta empresa.", { type: "string", format: "uuid" }),
          ],
          responses: {
            "200": { description: PAGE_DESCRIPTION, content: json("ContactPage") },
            "400": validationError,
            "503": unavailableError,
            ...authErrors,
          },
        },
        post: {
          summary:
            "Acha a pessoa pelo telefone ou a cria (`source: api`). Contato arquivado volta como está, sem " +
            "desarquivar; o `name` só preenche um nome vazio (renomear é pelo PATCH). Escopo: `contacts:write`.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              description: "8 a 200 caracteres entre letras, dígitos e `. _ : -`.",
              schema: { type: "string" },
            },
          ],
          requestBody: { required: true, content: json("ContactCreate") },
          responses: {
            "200": { description: "Já existia (o contato como está).", content: json("Contact") },
            "201": { description: "Criado.", content: json("Contact") },
            "400": errorResponse(
              "Campo inválido (`validation_error`), JSON inválido (`invalid_json`) ou Idempotency-Key ausente/malformada."
            ),
            "409": errorResponse(
              "Telefone de outra pessoa (`phone_conflict`), contato anonimizado (`contact_anonymized`) ou a mesma " +
                "Idempotency-Key ainda em andamento (`idempotency_in_progress`)."
            ),
            "415": errorResponse("Corpo fora de JSON (`unsupported_media_type`)."),
            "422": errorResponse("Idempotency-Key já usada com outra requisição (`idempotency_key_reused`)."),
            ...authErrors,
          },
        },
      },
      "/contacts/{id}": {
        get: {
          summary: "Um contato, arquivado inclusive. Escopo: `contacts:read`.",
          parameters: [idParam("do contato")],
          responses: {
            "200": { description: "O contato.", content: json("Contact") },
            "404": notFoundError,
            "503": unavailableError,
            ...authErrors,
          },
        },
        patch: {
          summary:
            "Altera nome, e-mail, observações e empresa. Ausente não mexe; `null` limpa. O telefone é imutável. " +
            "Escopo: `contacts:write`.",
          parameters: [idParam("do contato")],
          requestBody: { required: true, content: json("ContactUpdate") },
          responses: {
            "200": { description: "O contato alterado.", content: json("Contact") },
            "400": errorResponse("Campo inválido, nada para alterar (`validation_error`) ou JSON inválido (`invalid_json`)."),
            "404": notFoundError,
            "422": errorResponse(
              "`phone` no corpo (`phone_immutable`), ou empresa arquivada ou inexistente (`invalid_customer`)."
            ),
            ...authErrors,
          },
        },
      },
      "/customers": {
        get: {
          summary: "Empresas, com cursor. Escopo: `customers:read`.",
          parameters: [
            ...listParams,
            queryParam(
              "cnpj",
              "Igualdade exata, com ou sem máscara (aceita o CNPJ alfanumérico). Dígito verificador errado é 400."
            ),
          ],
          responses: {
            "200": { description: PAGE_DESCRIPTION, content: json("CustomerPage") },
            "400": validationError,
            "503": unavailableError,
            ...authErrors,
          },
        },
      },
      "/customers/{id}": {
        get: {
          summary: "Uma empresa, arquivada inclusive. Escopo: `customers:read`.",
          parameters: [idParam("da empresa")],
          responses: {
            "200": { description: "A empresa.", content: json("Customer") },
            "404": notFoundError,
            "503": unavailableError,
            ...authErrors,
          },
        },
      },
      "/customers/{id}/contract": {
        get: {
          summary:
            "O contrato atual, sem valor nem dia de vencimento: o vigente (ativo ou suspenso), senão o último " +
            "encerrado (a mesma regra do `contract_status` da empresa). Escopo: `customers:read`.",
          parameters: [idParam("da empresa")],
          responses: {
            "200": { description: "O contrato, ou `data: null` se a empresa nunca teve contrato.", content: json("Contract") },
            "404": notFoundError,
            "503": unavailableError,
            ...authErrors,
          },
        },
      },
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
