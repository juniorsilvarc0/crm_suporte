import { z } from "zod";

import { TICKET_PRIORITIES } from "@/features/tickets/lib/ticket-priority";
import { TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import { isTimelineInstant } from "@/features/tickets/lib/ticket-timeline";
import type { TicketSummary } from "@/features/tickets/types";
import { UUID_RE } from "@/lib/validation/uuid";

// Compartilhado entre o formulário (react-hook-form + zodResolver) e as rotas
// de ticket: a mesma regra valida os dois lados. O banco confere de novo o que
// é dele (checks de tickets e as RPCs). O ator nunca vem do corpo: a rota o tira
// da sessão, e .strict() responde 400 a quem o mandar.

// Texto vazio (ou só espaços, depois do trim) = "sem valor": vira null, porque
// o banco recusa texto em branco.
function blankToNull(value: string | null): string | null {
  return value ? value : null;
}

// O que o text do Postgres não guarda: NUL e surrogate solto. Passariam aqui e
// voltariam do banco como 22P05 (ou PGRST102, do PostgREST): um 500. Com a
// flag `u`, um par válido (emoji) é UM code point e não casa. Regex em vez de
// isWellFormed: o schema também roda no navegador. Exportados para os outros
// schemas de ticket (comentário) usarem a mesma regra e a mesma mensagem.
const PG_UNSAFE_TEXT = /[\u0000\p{Cs}]/u;

export function isPgSafeText(value: string): boolean {
  return !PG_UNSAFE_TEXT.test(value);
}

export const PG_UNSAFE_TEXT_MESSAGE = "Remova os caracteres inválidos.";

const title = z
  .string("Informe o título.")
  .trim()
  .min(3, "Use ao menos 3 caracteres.")
  .max(200, "Máximo de 200 caracteres.")
  .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE);

// Mesmo teto de tickets_description_check.
const description = z
  .string("Descrição inválida.")
  .trim()
  .max(10000, "Máximo de 10.000 caracteres.")
  .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE)
  .nullable()
  .transform(blankToNull);

const priority = z.enum(TICKET_PRIORITIES, "Escolha a prioridade.");

function uuid(message: string) {
  return z.string(message).regex(UUID_RE, message);
}

// Referência que pode ser tirada: uuid, null ou "" (seleção vazia) → null.
function nullableRef(message: string) {
  return z.string(message).nullable().transform(blankToNull).pipe(uuid(message).nullable());
}

// A versão que a tela leu (otimismo): a RPC responde VERSION_CONFLICT se mudou.
// Teto do integer do Postgres, para não virar 22003 no banco.
const version = z
  .number("Versão inválida.")
  .int("Versão inválida.")
  .min(1, "Versão inválida.")
  .max(2147483647, "Versão inválida.");

// POST /api/tickets e o "Novo ticket" do chat. A chave é gerada ao abrir o
// formulário (crypto.randomUUID) e repetida nos reenvios: o mesmo pedido nunca
// abre dois tickets. Minúscula porque o banco a guarda como texto.
export const ticketCreateSchema = z
  .object({
    conversation_id: uuid("Conversa inválida."),
    title,
    priority,
    description: description.optional(),
    product_id: nullableRef("Fila inválida.").optional(),
    category_id: nullableRef("Categoria inválida.").optional(),
    // "Assumir o atendimento" nasce ligado (decisão 12).
    take_over: z.boolean("Valor inválido.").default(true),
    idempotency_key: uuid("Chave de idempotência inválida.").transform((value) =>
      value.toLowerCase()
    ),
  })
  .strict();

// As chaves que ticket_update aceita em p_patch (fora delas: INVALID_PATCH).
export const TICKET_PATCH_FIELDS = [
  "title",
  "description",
  "priority",
  "product_id",
  "category_id",
  "customer_id",
] as const;

// PATCH /api/tickets/[id]: a versão e SÓ os campos alterados (o formulário
// manda os dirtyFields). ⚠️ .optional() por fora de cada campo: ausente fica
// AUSENTE, nunca null. É o que separa "não mexa" de "tire a fila".
export const ticketPatchSchema = z
  .object({
    version,
    title: title.optional(),
    description: description.optional(),
    priority: priority.optional(),
    product_id: nullableRef("Fila inválida.").optional(),
    category_id: nullableRef("Categoria inválida.").optional(),
    customer_id: nullableRef("Empresa inválida.").optional(),
  })
  .strict()
  .refine(
    (value) => TICKET_PATCH_FIELDS.some((field) => value[field] !== undefined),
    "Nada para atualizar."
  );

// POST /api/tickets/[id]/transition. Motivo só é exigido ao cancelar (a RPC
// confere de novo: REASON_REQUIRED); o teto é o de ticket_status_history.
export const ticketTransitionSchema = z
  .object({
    to: z.enum(TICKET_STATUS_KEYS, "Status inválido."),
    version,
    reason: z
      .string("Motivo inválido.")
      .trim()
      .max(500, "Máximo de 500 caracteres.")
      .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE)
      .nullish()
      .transform((value) => value || null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to === "cancelado" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Informe o motivo do cancelamento.",
      });
    }
  });

// POST /api/tickets/[id]/assign. A chave é obrigatória: null (tirar o
// responsável) tem de ser explícito, nunca um campo esquecido.
export const ticketAssignSchema = z
  .object({
    assignee_id: nullableRef("Responsável inválido."),
    version,
  })
  .strict();

// POST /api/tickets/[id]/take-over. `reassign` = tomar o ticket de outro
// analista, depois da confirmação na tela (sem ele: ALREADY_ASSIGNED).
export const ticketTakeOverSchema = z
  .object({ reassign: z.boolean("Valor inválido.").default(false) })
  .strict();

// PUT /api/chat/conversations/[id]/active-ticket. null = conversa sem foco.
export const ticketFocusSchema = z
  .object({ ticket_id: nullableRef("Ticket inválido.") })
  .strict();

// Instante como o PostgREST entrega (ISO com fuso, até microssegundos; mais de
// 6 casas o Postgres arredondaria). A regra é a de isTimelineInstant, a mesma
// com que a timeline compara: fonte única, para o schema não aceitar o que a
// lib recusa (fuso além de ±15:59) nem recusar o que o Postgres escreve (fuso
// histórico com segundos, `-03:06:28`).
const pgInstant = z.string("Instante inválido.").refine(isTimelineInstant, "Instante inválido.");

// GET /api/tickets/[id]/timeline?before=: o `at` do item mais antigo da página,
// CRU (a comparação no banco é estrita e em microssegundos; passar por Date
// perderia precisão). O cliente monta a URL com URLSearchParams: um "+" do fuso
// solto na URL chega aqui como espaço e é recusado.
export const ticketTimelineQuerySchema = z
  .object({ before: pgInstant.optional() })
  .strict();

// O jsonb de public.ticket_summary, que toda RPC de ticket devolve em `ticket`.
// Conferido em vez de confiado, e .strict(): uma chave nova no banco (ex.: o
// ai_triage ou a chave de idempotência entrando no resumo) falha alto aqui, em
// vez de sumir em silêncio ou chegar ao cliente.
export const ticketSummarySchema = z
  .object({
    id: z.string().regex(UUID_RE),
    number: z.number().int().positive(),
    title: z.string(),
    status: z.enum(TICKET_STATUS_KEYS),
    priority: z.enum(TICKET_PRIORITIES),
    version: z.number().int().min(1),
    conversation_id: z.string().regex(UUID_RE),
    assigned_to_user_id: z.string().regex(UUID_RE).nullable(),
    product_id: z.string().regex(UUID_RE).nullable(),
    category_id: z.string().regex(UUID_RE).nullable(),
    customer_id: z.string().regex(UUID_RE).nullable(),
    contract_id: z.string().regex(UUID_RE).nullable(),
    first_response_due_at: pgInstant,
    resolution_due_at: pgInstant,
    first_responded_at: pgInstant.nullable(),
    sla_paused_at: pgInstant.nullable(),
    resolved_at: pgInstant.nullable(),
    closed_at: pgInstant.nullable(),
    updated_at: pgInstant,
  })
  .strict() satisfies z.ZodType<TicketSummary>;

// Values = o que o formulário edita (z.input); Input = o que a rota/serviço
// recebe depois do parse (z.output).
export type TicketCreateValues = z.input<typeof ticketCreateSchema>;
export type TicketCreateInput = z.output<typeof ticketCreateSchema>;
export type TicketPatchValues = z.input<typeof ticketPatchSchema>;
export type TicketPatchInput = z.output<typeof ticketPatchSchema>;
export type TicketTransitionValues = z.input<typeof ticketTransitionSchema>;
export type TicketTransitionInput = z.output<typeof ticketTransitionSchema>;
export type TicketAssignInput = z.output<typeof ticketAssignSchema>;
export type TicketTakeOverInput = z.output<typeof ticketTakeOverSchema>;
export type TicketFocusInput = z.output<typeof ticketFocusSchema>;
export type TicketTimelineQuery = z.output<typeof ticketTimelineQuerySchema>;
