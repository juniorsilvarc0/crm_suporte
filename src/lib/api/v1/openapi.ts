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
import {
  attachmentLinkSchema,
  attachmentSchema,
  commentBodySchema,
  commentSchema,
  timelineItemSchema,
} from "@/lib/api/v1/ticket-activity";
import {
  ticketAssignBodySchema,
  ticketChangeSchema,
  ticketCreateBodySchema,
  ticketDetailSchema,
  ticketPatchBodySchema,
  ticketSchema,
  ticketTransitionBodySchema,
  ticketTransitionResultSchema,
} from "@/lib/api/v1/tickets";
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
    current: z.string().optional(),
    current_version: z.number().int().optional(),
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

const ticketRefParam = {
  name: "ref",
  in: "path",
  required: true,
  description: "O id (uuid) ou o protocolo, só o número (1024, sem o prefixo que a tela mostra).",
  schema: { type: "string" },
};

const ticketNotFoundError = errorResponse(
  "Não existe, ou o `ref` não é um uuid nem um protocolo numérico (`not_found`)."
);

const idempotencyKeyParam = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "8 a 200 caracteres entre letras, dígitos e `. _ : -`.",
  schema: { type: "string" },
};

const ifMatchParam = {
  name: "If-Match",
  in: "header",
  required: true,
  description: 'O ETag do ticket, W/"<version>" (do GET ou da última escrita).',
  schema: { type: "string" },
};

const withEtag = (description: string, schemaName: string) => ({
  description,
  headers: { ETag: { description: 'W/"<version>" do ticket.', schema: { type: "string" } } },
  content: json(schemaName),
});

/** Os erros de toda escrita num ticket existente. */
const ticketWriteErrors = {
  "400": errorResponse(
    "Campo inválido (`validation_error`), JSON inválido (`invalid_json`) ou If-Match malformado (`invalid_if_match`)."
  ),
  "404": ticketNotFoundError,
  "412": errorResponse(
    "O ticket mudou desde a versão do If-Match (`version_conflict`, com `current_version` e o ETag atual). Leia de novo."
  ),
  "422": errorResponse("Referência que o banco não aceita agora (ex.: `product_archived`, `assignee_inactive`), com `fields`."),
  "428": errorResponse("Sem If-Match (`precondition_required`)."),
  "503": errorResponse("A escrita pode ter valido, mas o ticket não pôde ser relido (`unavailable`). Repetir é seguro."),
};

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
        "(`Idempotent-Replayed: true`); a mesma chave com outra requisição é 422 `idempotency_key_reused`. " +
        "A chave vale para a URL exata: repita pelo MESMO caminho (o mesmo `ref`, id ou protocolo). " +
        "Corpo acima de 1 MB (50 MB no anexo) é 413 `payload_too_large`; acima do limite do servidor (64 MB), " +
        "o 413 vem dele, sem o envelope.",
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
        Ticket: z.toJSONSchema(itemOf(ticketDetailSchema)),
        TicketPage: z.toJSONSchema(pageOf(ticketSchema)),
        TicketChange: z.toJSONSchema(itemOf(ticketChangeSchema)),
        TicketTransitionResult: z.toJSONSchema(itemOf(ticketTransitionResultSchema)),
        TicketCreate: z.toJSONSchema(ticketCreateBodySchema, { io: "input" }),
        TicketPatch: z.toJSONSchema(ticketPatchBodySchema, { io: "input" }),
        TicketTransition: z.toJSONSchema(ticketTransitionBodySchema, { io: "input" }),
        TicketAssign: z.toJSONSchema(ticketAssignBodySchema, { io: "input" }),
        Comment: z.toJSONSchema(itemOf(commentSchema)),
        CommentCreate: z.toJSONSchema(commentBodySchema, { io: "input" }),
        Attachment: z.toJSONSchema(itemOf(attachmentSchema)),
        AttachmentLink: z.toJSONSchema(itemOf(attachmentLinkSchema)),
        TimelinePage: z.toJSONSchema(pageOf(timelineItemSchema)),
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
          parameters: [idempotencyKeyParam],
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
      "/tickets": {
        get: {
          summary: "Tickets, com cursor e filtros. Escopo: `tickets:read`.",
          parameters: [
            ...listParams.filter((param) => param.name !== "include_archived" && param.name !== "q"),
            queryParam(
              "q",
              "Busca no título, no nome do contato e na razão social, fantasia e CNPJ da empresa: tokens de 2+ " +
                "letras ou dígitos, sem acento nem caixa (só os 5 primeiros contam). Exige também `contacts:read` e " +
                "`customers:read` (senão, 403 `insufficient_scope`)."
            ),
            queryParam("status", "Um ou mais status, separados por vírgula (ex.: novo,em_triagem)."),
            queryParam("priority", "Uma ou mais prioridades, separadas por vírgula."),
            queryParam("is_terminal", "Só os encerrados (true) ou só os abertos (false).", { type: "boolean" }),
            queryParam("sla_breached", "Só os com prazo vencido agora (true) ou só os sem (false).", { type: "boolean" }),
            queryParam("product_id", "Só os desta fila.", { type: "string", format: "uuid" }),
            queryParam("assignee_id", "Só os deste responsável, ou `none` (sem responsável)."),
            queryParam("customer_id", "Só os desta empresa.", { type: "string", format: "uuid" }),
            queryParam("contact_id", "Só os deste contato.", { type: "string", format: "uuid" }),
            queryParam("conversation_id", "Só os desta conversa.", { type: "string", format: "uuid" }),
          ],
          responses: {
            "200": { description: PAGE_DESCRIPTION, content: json("TicketPage") },
            "400": validationError,
            "503": unavailableError,
            ...authErrors,
          },
        },
        post: {
          summary:
            "Abre um ticket na conversa, como o token (origem `ai` ou `api`, pelo tipo do token). O ticket novo " +
            "vira o foco da conversa. Idempotente: a mesma `Idempotency-Key` (ou o mesmo `external_id`) deste token " +
            "devolve o ticket já aberto. Numa repetição (`Idempotent-Replayed: true`) o ETag não vem: a versão está " +
            "em `data.version`. Escopo: `tickets:write`.",
          parameters: [idempotencyKeyParam],
          requestBody: { required: true, content: json("TicketCreate") },
          responses: {
            "200": withEtag("Já existia (o ticket como está).", "Ticket"),
            "201": withEtag("Aberto.", "Ticket"),
            "400": errorResponse(
              "Campo inválido (`validation_error`), JSON inválido (`invalid_json`) ou Idempotency-Key ausente/malformada."
            ),
            "404": errorResponse("Conversa não encontrada (`not_found`)."),
            "409": errorResponse("A mesma Idempotency-Key ainda em andamento (`idempotency_in_progress`)."),
            "415": errorResponse("Corpo fora de JSON (`unsupported_media_type`)."),
            "422": errorResponse(
              "Chave já usada com outra requisição, ou a chave ou o `external_id` já abriu um ticket em outra " +
                "conversa (`idempotency_key_reused`; com `external_id` no corpo, `fields.external_id`), ou referência " +
                "que o banco não aceita (ex.: `product_archived`, `category_product_mismatch`), com `fields`."
            ),
            "503": errorResponse("O ticket pode ter sido aberto, mas não pôde ser relido (`unavailable`). Repetir é seguro."),
            ...authErrors,
          },
        },
      },
      "/tickets/{ref}": {
        get: {
          summary: "Um ticket, pelo id ou pelo protocolo. O ETag da resposta é o que as escritas pedem. Escopo: `tickets:read`.",
          parameters: [ticketRefParam],
          responses: {
            "200": withEtag("O ticket.", "Ticket"),
            "404": ticketNotFoundError,
            "503": unavailableError,
            ...authErrors,
          },
        },
        patch: {
          summary:
            "Altera título, descrição, prioridade, fila, categoria e empresa. Ausente não mexe; null tira. Status e " +
            "responsável têm rota própria. O mesmo valor de novo é no-op (`changed: false`) antes de conferir a " +
            "versão. Escopo: `tickets:write`.",
          parameters: [ticketRefParam, ifMatchParam],
          requestBody: { required: true, content: json("TicketPatch") },
          responses: {
            "200": withEtag("O ticket alterado (ou igual, com `changed: false`).", "TicketChange"),
            "409": errorResponse("Ticket encerrado não muda (`ticket_terminal`)."),
            ...ticketWriteErrors,
            ...authErrors,
          },
        },
      },
      "/tickets/{ref}/transitions": {
        post: {
          summary:
            "Muda o status pela matriz (`GET /ticket-statuses` mostra os destinos). Cancelar exige `reason`. O mesmo " +
            "status de novo é no-op. Escopo: `tickets:write`.",
          parameters: [ticketRefParam, ifMatchParam],
          requestBody: { required: true, content: json("TicketTransition") },
          responses: {
            "200": withEtag("O ticket no status novo.", "TicketTransitionResult"),
            "409": errorResponse(
              "Destino fora da matriz (`invalid_transition`, com `allowed` e `current`). Ticket encerrado não tem " +
                "destino: `allowed` vem vazio."
            ),
            ...ticketWriteErrors,
            ...authErrors,
          },
        },
      },
      "/tickets/{ref}/assign": {
        post: {
          summary:
            "Troca o responsável (`GET /users` lista quem pode receber) ou tira (`assignee_id: null`). O mesmo de novo " +
            "é no-op. Escopo: `tickets:write`.",
          parameters: [ticketRefParam, ifMatchParam],
          requestBody: { required: true, content: json("TicketAssign") },
          responses: {
            "200": withEtag("O ticket com o responsável novo.", "TicketChange"),
            "409": errorResponse("Ticket encerrado não muda (`ticket_terminal`)."),
            ...ticketWriteErrors,
            ...authErrors,
          },
        },
      },
      "/tickets/{ref}/comments": {
        post: {
          summary:
            "Comentário INTERNO no ticket, com o token como autor. Nunca vai ao cliente; vale também em ticket " +
            "encerrado. A Idempotency-Key protege a repetição por 24 h; se o servidor cair entre gravar e " +
            "responder, repetir depois de 5 min pode gravar de novo. Escopo: `comments:write`.",
          parameters: [ticketRefParam, idempotencyKeyParam],
          requestBody: { required: true, content: json("CommentCreate") },
          responses: {
            "201": { description: "O comentário.", content: json("Comment") },
            "400": errorResponse(
              "Corpo inválido (`validation_error`), JSON inválido (`invalid_json`) ou Idempotency-Key ausente/malformada."
            ),
            "404": ticketNotFoundError,
            "409": errorResponse("A mesma Idempotency-Key ainda em andamento (`idempotency_in_progress`)."),
            "413": errorResponse("Corpo acima de 1 MB (`payload_too_large`)."),
            "415": errorResponse("Corpo fora de JSON, multipart inclusive (`unsupported_media_type`)."),
            "422": errorResponse("Idempotency-Key já usada com outra requisição (`idempotency_key_reused`)."),
            "503": unavailableError,
            ...authErrors,
          },
        },
      },
      "/tickets/{ref}/attachments": {
        post: {
          summary:
            "Anexa um arquivo ao ticket, com o token como autor: multipart/form-data, só o campo `file`, até 50 MB. " +
            'No Content-Disposition da parte, `name="file"` e `filename="..."` vão ENTRE ASPAS, em UTF-8, sem ' +
            "`filename*` (o padrão do curl, do requests e do n8n; o HttpClient do .NET precisa ser ajustado). " +
            "HTML, SVG e afins são guardados como application/octet-stream. Reenviar o MESMO arquivo (mesmos bytes, " +
            "nome e tipo) com a mesma Idempotency-Key repete a resposta sem gravar de novo, por 24 h; se o servidor " +
            "cair entre gravar e responder, repetir depois de 5 min pode gravar de novo. Escopo: `attachments:write`.",
          parameters: [ticketRefParam, idempotencyKeyParam],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: { file: { type: "string", format: "binary" } },
                  required: ["file"],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "201": { description: "O anexo (sem o arquivo: o link sai pelo GET do anexo).", content: json("Attachment") },
            "400": errorResponse(
              "Sem arquivo, mais de um, arquivo vazio ou campo a mais (`validation_error`), multipart que o " +
                "servidor não leu (`invalid_multipart`: confira as aspas do Content-Disposition) ou Idempotency-Key " +
                "ausente/malformada."
            ),
            "404": ticketNotFoundError,
            "409": errorResponse("A mesma Idempotency-Key ainda em andamento (`idempotency_in_progress`)."),
            "413": errorResponse(
              "Acima de 50 MB (`payload_too_large`), recusado pelo Content-Length antes de ler o corpo."
            ),
            "415": errorResponse("Corpo fora de multipart/form-data, JSON inclusive (`unsupported_media_type`)."),
            "422": errorResponse("Idempotency-Key já usada com outro arquivo (`idempotency_key_reused`)."),
            "502": errorResponse("O armazenamento falhou (`storage_unavailable`, com `Retry-After`). Repetir é seguro."),
            "503": unavailableError,
            ...authErrors,
          },
        },
      },
      "/tickets/{ref}/attachments/{attachment_id}": {
        get: {
          summary:
            "O link do arquivo: uma URL assinada de 10 min, com nome, tipo e tamanho. Não guarde a URL: peça outra " +
            "quando precisar. Escopo: `attachments:read`.",
          parameters: [
            ticketRefParam,
            {
              name: "attachment_id",
              in: "path",
              required: true,
              description: "UUID do anexo (o `id` do POST ou do item `attachment` da timeline).",
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": { description: "O link.", content: json("AttachmentLink") },
            "404": errorResponse("Ticket ou anexo inexistente, ou anexo de outro ticket (`not_found`)."),
            "502": errorResponse("Não deu para assinar o link agora (`storage_unavailable`, com `Retry-After`)."),
            "503": unavailableError,
            ...authErrors,
          },
        },
      },
      "/tickets/{ref}/timeline": {
        get: {
          summary:
            "A timeline do ticket, do MAIS NOVO para o mais antigo (ao contrário das outras listas). Com " +
            "`tickets:read` vêm a trilha (`status` e `event`) e os anexos (`attachment`). O resto é de outro recurso " +
            "e só entra com o escopo dele: `message` (mensagens da conversa carimbadas com o ticket) exige " +
            "`conversations:read`; `comment` (comentário interno) exige `comments:read`; e a nota interna no chat " +
            "(`message` com `type: note`) exige os dois. Sem o escopo, esses itens não aparecem (não é erro). " +
            "Comentário e nota são do time: nunca repita ao cliente. Escopo: `tickets:read`.",
          parameters: [
            ticketRefParam,
            queryParam(
              "cursor",
              "O `meta.next_cursor` da resposta anterior: leva à página seguinte, com itens mais ANTIGOS. Opaco: não " +
                "monte à mão. Não há `limit`: cada página traz cerca de 100 itens, sem dividir um mesmo instante. " +
                "Para ver o que chegou depois, leia de novo sem cursor."
            ),
          ],
          responses: {
            "200": {
              description: "Uma página, da mais nova para a mais antiga. `meta.next_cursor: null` = chegou ao início.",
              content: json("TimelinePage"),
            },
            "400": validationError,
            "404": ticketNotFoundError,
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
