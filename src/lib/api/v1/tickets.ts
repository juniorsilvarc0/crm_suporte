import { NextResponse } from "next/server";
import { z } from "zod";

import { getSlaState } from "@/features/tickets/lib/sla";
import { TICKET_PRIORITIES } from "@/features/tickets/lib/ticket-priority";
import { TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import { isPgSafeText, PG_UNSAFE_TEXT_MESSAGE, ticketFieldSchemas } from "@/features/tickets/schemas/ticket";
import type { TicketError, TicketListItem, TicketSource } from "@/features/tickets/types";
import { listQueryShape } from "@/lib/api/v1/cursor";
import { apiError } from "@/lib/api/v1/errors";
import { ETAG_HEADER, etagFor } from "@/lib/api/v1/if-match";
import { searchTokens } from "@/lib/formatters/search-text";
import { UUID_RE } from "@/lib/validation/uuid";

// Ticket da API v1: o DTO (do /context e do recurso /tickets), os corpos de
// entrada e a tradução dos erros das RPCs para o envelope da v1. Campo a campo,
// em snake_case: sem cor, foto nem texto de selo, que são da tela. O SLA sai
// calculado pela MESMA regra da view ticket_queue (lib/sla.ts).

const TICKET_SOURCES = ["ai", "agent", "api"] as const satisfies readonly TicketSource[];

const ref = z.strictObject({ id: z.string(), name: z.string() });

export const ticketSchema = z.strictObject({
  id: z.string(),
  /** O protocolo que o cliente vê. */
  number: z.number().int(),
  title: z.string(),
  status: z.enum(TICKET_STATUS_KEYS),
  priority: z.enum(TICKET_PRIORITIES),
  source: z.enum(TICKET_SOURCES).describe("Quem abriu: agent (tela), ai ou api."),
  version: z
    .number()
    .int()
    .describe('Sobe a cada alteração do ticket. É o ETag (W/"<version>") que as escritas exigem no If-Match.'),
  conversation_id: z.string(),
  contact_id: z.string(),
  customer_id: z.string().nullable(),
  is_terminal: z.boolean().describe("Fechado ou cancelado: não muda mais de status."),
  product: ref.nullable(),
  assignee: ref.nullable(),
  sla: z.strictObject({
    breached: z
      .boolean()
      .describe(
        "Vencido AGORA (a regra do filtro sla_breached): 1ª resposta pendente depois do prazo, ou solução vencida " +
          "com o relógio correndo ou pausado fora do prazo. Resolvido, fechado ou cancelado é sempre false. " +
          "Calculado no instante da resposta."
      ),
    at_risk: z
      .boolean()
      .describe("Nada vencido, mas já passou do percentual de aviso. Sempre false com o relógio parado."),
    next_due_at: z.string().nullable().describe("O próximo prazo correndo; null = relógio parado."),
    first_response_due_at: z.string(),
    resolution_due_at: z.string(),
    first_responded_at: z.string().nullable(),
  }),
  resolved_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** O ticket inteiro (GET /tickets/{ref} e o retorno das escritas). */
export const ticketDetailSchema = ticketSchema.extend({
  description: z.string().nullable(),
  /** A categoria atual, arquivada inclusive. */
  category: ref.nullable(),
});

export type ApiTicket = z.infer<typeof ticketSchema>;
export type ApiTicketDetail = z.infer<typeof ticketDetailSchema>;

export function toApiTicket(ticket: TicketListItem, now: Date): ApiTicket {
  const sla = getSlaState(ticket, now);
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    version: ticket.version,
    conversation_id: ticket.conversation_id,
    contact_id: ticket.contact.id,
    customer_id: ticket.customer?.id ?? null,
    is_terminal: ticket.is_terminal,
    product: ticket.product ? { id: ticket.product.id, name: ticket.product.name } : null,
    assignee: ticket.assignee ? { id: ticket.assignee.id, name: ticket.assignee.name } : null,
    sla: {
      breached: sla.breached,
      at_risk: sla.atRisk,
      next_due_at: sla.nextDueAt,
      first_response_due_at: ticket.first_response_due_at,
      resolution_due_at: ticket.resolution_due_at,
      first_responded_at: ticket.first_responded_at,
    },
    resolved_at: ticket.resolved_at,
    closed_at: ticket.closed_at,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
  };
}

export function toApiTicketDetail(
  ticket: TicketListItem,
  extra: { description: string | null; category: { id: string; name: string } | null },
  now: Date
): ApiTicketDetail {
  return {
    ...toApiTicket(ticket, now),
    description: extra.description,
    category: extra.category ? { id: extra.category.id, name: extra.category.name } : null,
  };
}

// ─── Entradas ────────────────────────────────────────────────────────────────

const f = ticketFieldSchemas;
const BODY_MESSAGE = "Envie um objeto JSON.";

/** `{ref}` da rota: o id (uuid) ou o protocolo (número). */
export function parseTicketRef(value: unknown): { id: string } | { number: number } | null {
  if (typeof value !== "string") return null;
  if (UUID_RE.test(value)) return { id: value.toLowerCase() };
  if (/^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647) return { number: Number(value) };
  return null;
}

/** Lista separada por vírgula; o erro fica no próprio parâmetro (não em `status.1`). */
const csvOf = <T extends string>(values: readonly T[], message: string) =>
  z.string().transform((value, ctx) => {
    const items = value.split(",").map((item) => item.trim());
    if (!items.every((item): item is T => values.some((allowed) => allowed === item))) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return items as T[];
  });

const flag = z
  .enum(["true", "false"], { error: "Use true ou false." })
  .transform((value) => value === "true");

const uuidParam = (message: string) => z.string({ error: message }).regex(UUID_RE, { error: message });

// Ticket não se arquiva: `include_archived` sai dos parâmetros comuns, para
// não ser aceito sem efeito.
const pageQueryShape = {
  cursor: listQueryShape.cursor,
  limit: listQueryShape.limit,
  updated_since: listQueryShape.updated_since,
};

export const ticketListQuerySchema = z.strictObject({
  ...pageQueryShape,
  /** Um ou mais status, separados por vírgula. */
  status: csvOf(TICKET_STATUS_KEYS, "Status inválido.").optional(),
  priority: csvOf(TICKET_PRIORITIES, "Prioridade inválida.").optional(),
  is_terminal: flag.optional(),
  sla_breached: flag.optional(),
  product_id: uuidParam("Fila inválida.").optional(),
  /** Um uuid, ou `none` (sem responsável). */
  assignee_id: z
    .union([z.literal("none"), uuidParam("Responsável inválido.")], { error: "Responsável inválido." })
    .optional(),
  customer_id: uuidParam("Empresa inválida.").optional(),
  contact_id: uuidParam("Contato inválido.").optional(),
  conversation_id: uuidParam("Conversa inválida.").optional(),
  q: z
    .string()
    .trim()
    .max(100, { error: "No máximo 100 caracteres." })
    .refine((q) => q === "" || searchTokens(q).length > 0, {
      error: "Use ao menos um termo de 2 ou mais letras ou dígitos.",
    })
    .optional(),
});

/** Teto de tickets_ai_triage_check: octet_length(ai_triage::text). */
const AI_TRIAGE_MAX_BYTES = 16384;

/**
 * Bytes do JSON como o jsonb do Postgres o escreve (`": "` e `", "`, mais
 * largos que o JSON compacto), para o teto bater com o do banco. `null` =
 * valor que o banco não guarda igual: string com NUL ou surrogate solto, ou
 * número em notação científica (o numeric do jsonb o expande dígito a dígito).
 * O check do banco continua sendo o juiz final, e o erro dele aponta o campo.
 */
function jsonbTextBytes(value: unknown): number | null {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    const text = JSON.stringify(value);
    return /e/i.test(text) ? null : text.length;
  }
  if (typeof value === "string") {
    return isPgSafeText(value) ? Buffer.byteLength(JSON.stringify(value), "utf8") : null;
  }
  if (Array.isArray(value)) {
    let total = 2;
    for (const [index, item] of value.entries()) {
      const bytes = jsonbTextBytes(item);
      if (bytes === null) return null;
      total += bytes + (index > 0 ? 2 : 0);
    }
    return total;
  }
  if (typeof value === "object") {
    let total = 2;
    for (const [index, [key, item]] of Object.entries(value).entries()) {
      const keyBytes = jsonbTextBytes(key);
      const bytes = jsonbTextBytes(item);
      if (keyBytes === null || bytes === null) return null;
      total += keyBytes + 2 + bytes + (index > 0 ? 2 : 0);
    }
    return total;
  }
  return null;
}

/**
 * Referência da integração: uuid ou null, e só. A tela aceita "" (select
 * vazio) como null; na API um "" que tira a fila em silêncio é erro do cliente.
 */
const refId = (message: string) => uuidParam(message).nullable();

export const ticketCreateBodySchema = z.strictObject(
  {
    conversation_id: f.conversation_id,
    title: f.title,
    priority: f.priority.default("media"),
    description: f.description.optional(),
    product_id: refId("Fila inválida.").optional(),
    category_id: refId("Categoria inválida.").optional(),
    assignee_id: refId("Responsável inválido.").optional(),
    status: z
      .enum(["novo", "em_triagem"], { error: "Ticket nasce em novo ou em_triagem." })
      .optional()
      .describe("Status inicial; padrão novo."),
    external_id: z
      .string({ error: "Id externo de 1 a 200 caracteres." })
      .trim()
      .min(1, { error: "Id externo de 1 a 200 caracteres." })
      .max(200, { error: "Id externo de 1 a 200 caracteres." })
      .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE)
      .optional()
      .describe(
        "O id do ticket no seu sistema, único por token. Repetir na MESMA conversa devolve o ticket já aberto; " +
          "em outra conversa é 422 idempotency_key_reused."
      ),
    ai_triage: z
      .record(z.string(), z.unknown(), { error: "Envie um objeto JSON." })
      .superRefine((value, ctx) => {
        const bytes = jsonbTextBytes(value);
        if (bytes === null) {
          ctx.addIssue({
            code: "custom",
            message: "Valor que o banco não guarda: caractere NUL, surrogate solto ou número em notação científica.",
          });
        } else if (bytes > AI_TRIAGE_MAX_BYTES) {
          ctx.addIssue({ code: "custom", message: "Triagem grande demais: no máximo 16 KB como o banco guarda o JSON." });
        }
      })
      .optional()
      .describe(
        'O que a triagem concluiu (objeto livre). Até 16 KB medidos como o banco guarda o JSON (com ": " e ", "); ' +
          "sem números em notação científica. Fica guardado no ticket."
      ),
  },
  { error: BODY_MESSAGE }
);

export const ticketPatchBodySchema = z
  .strictObject(
    {
      title: f.title.optional(),
      description: f.description.optional(),
      priority: f.priority.optional(),
      product_id: refId("Fila inválida.").optional(),
      category_id: refId("Categoria inválida.").optional(),
      customer_id: refId("Empresa inválida.").optional(),
    },
    { error: BODY_MESSAGE }
  )
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: "Nada para alterar.",
  });

export const ticketTransitionBodySchema = z
  .strictObject({ to: f.status, reason: f.reason }, { error: BODY_MESSAGE })
  .superRefine((value, ctx) => {
    if (value.to === "cancelado" && !value.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Informe o motivo do cancelamento." });
    }
  });

/** `assignee_id` obrigatório: null (tirar o responsável) tem de ser explícito. */
export const ticketAssignBodySchema = z.strictObject(
  { assignee_id: refId("Responsável inválido.") },
  { error: BODY_MESSAGE }
);

// ─── Respostas das escritas ──────────────────────────────────────────────────

/** PATCH e assign: o ticket relido e se algo mudou. */
export const ticketChangeSchema = z.strictObject({ ticket: ticketDetailSchema, changed: z.boolean() });
/** transitions: o mesmo, com de onde para onde. */
export const ticketTransitionResultSchema = ticketChangeSchema.extend({
  from: ticketSchema.shape.status,
  to: ticketSchema.shape.status,
});

/** Resposta de uma escrita: o ticket inteiro, relido, com o ETag da versão nova. */
export function ticketResponse(data: unknown, version: number, status = 200) {
  return NextResponse.json({ ok: true as const, data }, { status, headers: { [ETAG_HEADER]: etagFor(version) } });
}

/**
 * O erro de negócio das RPCs (map-ticket-error) no envelope da v1. As
 * diferenças para a tela:
 *   - versão velha é 412 (a versão veio no If-Match), com a atual no ETag;
 *   - chave de abertura reusada é 422 (D6), como a do Idempotency-Key;
 *   - `validation` vira `validation_error`, o código das outras rotas da v1.
 * O 500 já foi logado pelo ticket-service; a mensagem do banco nunca sai.
 */
export function ticketApiError(requestId: string, error: TicketError, context: { externalId?: boolean } = {}) {
  if (error.status >= 500) {
    return apiError(requestId, 500, "internal_error", "Erro interno. Informe o request_id ao suporte.");
  }
  if (error.code === "version_conflict") {
    return apiError(
      requestId,
      412,
      "version_conflict",
      "O ticket mudou desde a versão do If-Match. Leia de novo e repita.",
      error.currentVersion ? { current_version: error.currentVersion } : {},
      error.currentVersion ? { [ETAG_HEADER]: etagFor(error.currentVersion) } : {}
    );
  }
  if (error.code === "idempotency_key_reused") {
    // A RPC não diz qual das duas casou: com external_id no corpo, pode ter
    // sido ele (único por token, em qualquer conversa).
    if (context.externalId) {
      const message = "Esta Idempotency-Key ou este external_id já abriu um ticket em outra conversa.";
      return apiError(requestId, 422, "idempotency_key_reused", message, { fields: { external_id: message } });
    }
    return apiError(requestId, 422, "idempotency_key_reused", "Esta Idempotency-Key já abriu um ticket em outra conversa.");
  }
  return apiError(requestId, error.status, error.code === "validation" ? "validation_error" : error.code, error.message, {
    ...(error.field ? { fields: { [error.field]: error.message } } : {}),
    ...(error.allowed ? { allowed: error.allowed } : {}),
    ...(error.current ? { current: error.current } : {}),
    // conversation_not_owned_by_ai: o estado que decidiu o erro é o da conversa.
    ...(error.conversationStatus ? { current: error.conversationStatus } : {}),
  });
}
