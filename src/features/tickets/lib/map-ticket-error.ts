import { z } from "zod";

import { TICKET_STATUS_KEYS, isTicketStatus } from "@/features/tickets/lib/ticket-status";
import type {
  TicketCatalogError,
  TicketCatalogErrorBody,
  TicketCatalogErrorField,
  TicketError,
} from "@/features/tickets/types";
import { isUuid } from "@/lib/validation/uuid";

// Traduz os erros do banco nas RPCs e tabelas de ticket (migration _tickets) em
// status HTTP + `code` estável + mensagem amigável, marcando o campo quando o
// erro é de um input específico. É o 3º mapa do tipo (map-user-rpc-error,
// map-cadastro-error): duplicado de propósito, a generalização é um PR à parte
// (decisão 20 da Fase 4).
//
// Ordem de leitura:
//   1. TAG na message — raise exception 'TAG' das RPCs e dos triggers;
//   2. nome da constraint na message — o Postgres cita o nome em 23505/23514/23503;
//   3. code.
//
// Extras lidos do DETAIL/HINT (formato conferido no banco local):
//   INVALID_TRANSITION → DETAIL = jsonb dos destinos permitidos
//     ('["aguardando_cliente", "resolvido"]', ou '[]' de um terminal); HINT = status atual.
//     O guard de tickets levanta a mesma TAG só com o HINT: `allowed` fica ausente.
//   VERSION_CONFLICT → DETAIL = versão atual ('3').
//   ALREADY_ASSIGNED → DETAIL = uuid de quem está com o ticket.
// DETAIL que não confere é descartado: o erro continua o mesmo, só sem o extra.
//
// status 500 = bug ou falha do banco: ticketErrorResponse loga antes de
// responder, e a mensagem nunca repassa error.message ao cliente.

type DatabaseErrorLike = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

// O que a tabela guarda: os extras dependem do DETAIL/HINT de cada erro.
type TicketErrorEntry = Omit<TicketError, "allowed" | "current" | "currentVersion" | "assignedToUserId">;

const INTERNAL_ERROR: TicketErrorEntry = {
  status: 500,
  code: "internal",
  message: "Não foi possível concluir a operação.",
};

const VALIDATION_MESSAGE = "Revise os campos destacados.";

// Levantada da migration (grep "raise exception"); o teste confere que a lista
// e a migration batem e que nenhuma TAG é trecho de outra (INVALID_STATUS ≠
// INVALID_INITIAL_STATUS), então a ordem da lista não decide empate.
// Fora daqui: 'conversation_not_found', minúscula, de clear_chat_conversation
// (a rota do chat traduz), e as 'TICKETS: …' da própria aplicação da migration.
const TAG_ERRORS: ReadonlyArray<readonly [string, TicketErrorEntry]> = [
  // 409 — o estado do ticket não permite; a tela relê e mostra o motivo.
  [
    "INVALID_TRANSITION",
    {
      status: 409,
      code: "invalid_transition",
      message: "Esse movimento não é permitido a partir do status atual.",
    },
  ],
  [
    "VERSION_CONFLICT",
    {
      status: 409,
      code: "version_conflict",
      message: "O ticket mudou em outro lugar. Recarregue para ver a versão atual.",
    },
  ],
  [
    "ALREADY_ASSIGNED",
    { status: 409, code: "already_assigned", message: "Este ticket já está com outro analista." },
  ],
  [
    "TICKET_TERMINAL",
    { status: 409, code: "ticket_terminal", message: "Ticket encerrado não pode ser alterado." },
  ],
  [
    "CONVERSATION_HAS_TICKETS",
    {
      status: 409,
      code: "conversation_has_tickets",
      message: "A conversa tem ticket; limpar apagaria o histórico do atendimento.",
    },
  ],
  [
    "IDEMPOTENCY_KEY_REUSED",
    {
      status: 409,
      code: "idempotency_key_reused",
      message: "Esta abertura já foi usada em outra conversa. Abra o formulário de novo.",
    },
  ],
  [
    "COMMENT_DELETED",
    { status: 409, code: "comment_deleted", message: "Comentário apagado não pode ser alterado." },
  ],

  // 404
  ["TICKET_NOT_FOUND", { status: 404, code: "not_found", message: "Ticket não encontrado." }],
  ["CONVERSATION_NOT_FOUND", { status: 404, code: "not_found", message: "Conversa não encontrada." }],

  // 422 — a referência existe no pedido, mas o banco não a aceita agora.
  [
    "PRODUCT_NOT_FOUND",
    { status: 422, code: "product_not_found", message: "Fila não encontrada.", field: "product_id" },
  ],
  [
    "PRODUCT_ARCHIVED",
    {
      status: 422,
      code: "product_archived",
      message: "Fila arquivada. Escolha outra.",
      field: "product_id",
    },
  ],
  [
    "CATEGORY_NOT_FOUND",
    {
      status: 422,
      code: "category_not_found",
      message: "Categoria não encontrada.",
      field: "category_id",
    },
  ],
  [
    "CATEGORY_ARCHIVED",
    {
      status: 422,
      code: "category_archived",
      message: "Categoria arquivada. Escolha outra.",
      field: "category_id",
    },
  ],
  [
    "CATEGORY_PRODUCT_MISMATCH",
    {
      status: 422,
      code: "category_product_mismatch",
      message: "A categoria é de outra fila.",
      field: "category_id",
    },
  ],
  // As duas abaixo só saem do trigger de ticket_categories (gestão de
  // categorias, admin): não são campo de ticket.
  [
    "CATEGORY_TOO_DEEP",
    { status: 422, code: "category_too_deep", message: "Categoria tem no máximo dois níveis." },
  ],
  [
    "CATEGORY_HAS_ACTIVE_CHILDREN",
    {
      status: 422,
      code: "category_has_active_children",
      message: "Arquive as subcategorias antes da categoria.",
    },
  ],
  [
    "CUSTOMER_NOT_FOUND",
    {
      status: 422,
      code: "customer_not_found",
      message: "Empresa não encontrada.",
      field: "customer_id",
    },
  ],
  [
    "CUSTOMER_ARCHIVED",
    {
      status: 422,
      code: "customer_archived",
      message: "Empresa arquivada. Reative-a antes.",
      field: "customer_id",
    },
  ],
  [
    "ASSIGNEE_INACTIVE",
    {
      status: 422,
      code: "assignee_inactive",
      message: "Responsável inativo ou inexistente.",
      field: "assignee_id",
    },
  ],
  [
    "TICKET_NOT_IN_CONVERSATION",
    {
      status: 422,
      code: "ticket_not_in_conversation",
      message: "O ticket não é desta conversa.",
      field: "ticket_id",
    },
  ],
  [
    "REASON_REQUIRED",
    {
      status: 422,
      code: "reason_required",
      message: "Informe o motivo do cancelamento.",
      field: "reason",
    },
  ],

  // 400 — entrada que o zod deveria ter barrado (ou cliente da API desatualizado).
  ["INVALID_PATCH", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["INVALID_STATUS", { status: 400, code: "validation", message: "Status inválido.", field: "to" }],
  ["INVALID_INITIAL_STATUS", { status: 400, code: "validation", message: "Status inicial inválido." }],
  [
    "INVALID_PRIORITY",
    { status: 400, code: "validation", message: "Prioridade inválida.", field: "priority" },
  ],
  ["INVALID_SOURCE", { status: 400, code: "validation", message: "Origem do ticket inválida." }],
  [
    "INVALID_ASSIGNEE",
    { status: 400, code: "validation", message: "Ao assumir, o ticket fica com quem o abre." },
  ],

  // 403 — ator inativo ou revogado entre o guard e a RPC, ou token querendo assumir.
  [
    "FORBIDDEN",
    { status: 403, code: "forbidden", message: "Você não tem permissão para esta ação." },
  ],

  // 500 — o app nunca deveria chegar aqui: ator mal passado, escrita direta no
  // foco, na trilha ou em coluna imutável. É bug; loga.
  ["INVALID_ACTOR", INTERNAL_ERROR],
  ["ACTIVE_TICKET_READ_ONLY", INTERNAL_ERROR],
  ["TICKET_IMMUTABLE", INTERNAL_ERROR],
  ["TICKET_LOG_APPEND_ONLY", INTERNAL_ERROR],
];

// Para o teste conferir a lista contra a migration.
export const TICKET_ERROR_TAGS: readonly string[] = TAG_ERRORS.map(([tag]) => tag);

// Só as constraints de ENTRADA (o que o usuário ou o cliente da API mandou). As
// de invariante (relógio do SLA, carimbos, ator da trilha…) caem no 500 do
// fim: violá-las é bug de RPC, e um 400 sem log o esconderia.
const CONSTRAINT_ERRORS: ReadonlyArray<readonly [string, TicketErrorEntry]> = [
  [
    "tickets_title_check",
    {
      status: 400,
      code: "validation",
      message: "Use de 3 a 200 caracteres no título.",
      field: "title",
    },
  ],
  [
    "tickets_description_check",
    {
      status: 400,
      code: "validation",
      message: "Descrição longa demais (máximo de 10.000 caracteres).",
      field: "description",
    },
  ],
  [
    "ticket_status_history_reason_check",
    {
      status: 400,
      code: "validation",
      message: "Motivo longo demais (máximo de 500 caracteres).",
      field: "reason",
    },
  ],
  [
    "tickets_idempotency_key_check",
    {
      status: 400,
      code: "validation",
      message: "Chave de idempotência inválida.",
      field: "idempotency_key",
    },
  ],
  // Integração (Fase 5), comentários, anexos e catálogos do admin: sem campo de
  // ticket, a rota que precisar marca o próprio.
  ["tickets_external_id_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["tickets_ai_triage_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["ticket_comments_body_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  [
    "ticket_attachments_file_name_check",
    { status: 400, code: "validation", message: VALIDATION_MESSAGE },
  ],
  ["ticket_attachments_mime_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["ticket_attachments_size_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["ticket_categories_name_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["ticket_statuses_label_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["ticket_statuses_color_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  [
    "sla_policies_first_response_check",
    { status: 400, code: "validation", message: VALIDATION_MESSAGE },
  ],
  ["sla_policies_resolution_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  [
    "sla_policies_order_check",
    {
      status: 400,
      code: "validation",
      message: "A 1ª resposta não pode ter prazo maior que a solução.",
    },
  ],
  ["sla_policies_warn_pct_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  // Fila (products, migration _cadastros), editada pela 4f.
  ["products_name_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["products_niche_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  ["products_color_format_check", { status: 400, code: "validation", message: VALIDATION_MESSAGE }],
  // Nome repetido (23505): a rota do catálogo devolve o item existente, no
  // molde de POST /api/products.
  [
    "ticket_statuses_label_uidx",
    { status: 409, code: "duplicate", message: "Já existe um status com este rótulo." },
  ],
  [
    "ticket_categories_name_active_uidx",
    { status: 409, code: "duplicate", message: "Já existe uma categoria com este nome." },
  ],
  [
    "products_name_active_uidx",
    { status: 409, code: "duplicate", message: "Já existe uma fila com este nome." },
  ],
  // O trigger de categorias deixa a mãe inexistente para a FK (23503).
  [
    "ticket_categories_parent_id_fkey",
    { status: 422, code: "category_not_found", message: "Categoria não encontrada." },
  ],
  [
    "ticket_categories_product_id_fkey",
    {
      status: 422,
      code: "product_not_found",
      message: "Fila não encontrada.",
      field: "product_id",
    },
  ],
];

// Entrada que o banco não aceitou pelo tipo: texto em uuid (22P02), número fora
// da faixa (22003), data fora do intervalo (22008), obrigatório nulo (23502),
// caractere que o tipo text não guarda, como NUL (22P05: o zod já recusa, aqui é
// a rede de segurança). O PGRST102 fica de fora: o PostgREST não leu o JSON que
// o próprio serviço montou, e isso é bug (500).
const INVALID_INPUT_CODES = new Set(["22P02", "22003", "22008", "22P05", "23502"]);

const allowedSchema = z.array(z.enum(TICKET_STATUS_KEYS));

function parseAllowed(details: string | null | undefined): TicketError["allowed"] {
  if (!details) return undefined;
  try {
    const result = allowedSchema.safeParse(JSON.parse(details));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function parseVersion(details: string | null | undefined): number | undefined {
  if (!details || !/^[1-9]\d{0,9}$/.test(details)) return undefined;
  return Number(details);
}

function withExtras(tag: string, entry: TicketErrorEntry, error: DatabaseErrorLike): TicketError {
  // Cópia: a rota pode acrescentar campos à resposta sem alterar a tabela.
  const mapped: TicketError = { ...entry };

  if (tag === "INVALID_TRANSITION") {
    const allowed = parseAllowed(error.details);
    if (allowed) mapped.allowed = allowed;
    if (isTicketStatus(error.hint)) mapped.current = error.hint;
  } else if (tag === "VERSION_CONFLICT") {
    const currentVersion = parseVersion(error.details);
    if (currentVersion !== undefined) mapped.currentVersion = currentVersion;
  } else if (tag === "ALREADY_ASSIGNED") {
    if (isUuid(error.details)) mapped.assignedToUserId = error.details;
  }
  return mapped;
}

export function mapTicketError(error: DatabaseErrorLike | null | undefined): TicketError {
  const source = error ?? {};
  const message = source.message ?? "";

  for (const [tag, entry] of TAG_ERRORS) {
    if (message.includes(tag)) return withExtras(tag, entry, source);
  }
  for (const [constraint, entry] of CONSTRAINT_ERRORS) {
    if (message.includes(constraint)) return { ...entry };
  }

  if (source.code && INVALID_INPUT_CODES.has(source.code)) {
    return { status: 400, code: "validation", message: VALIDATION_MESSAGE };
  }
  // Inclui o 42501 sem TAG (grant faltando ou select que tocou coluna sem
  // grant) e a constraint de invariante: bug — 500, nunca 403 nem 400.
  return { ...INTERNAL_ERROR };
}

// Rotas de catálogo (4f, admin): qual formulário leu o erro.
export type TicketCatalogErrorContext =
  | "product"
  | "category_create"
  | "category_update"
  | "sla_policy"
  | "ticket_status";

type CatalogOverride = { field: TicketCatalogErrorField; message?: string };

const CATALOG_NAME_MESSAGE = "Informe um nome de até 80 caracteres.";
const SLA_MINUTES_MESSAGE = "Use de 1 a 525.600 minutos.";

// O campo do formulário do catálogo e, onde a mensagem do ticket não serve, a
// do catálogo: CATEGORY_ARCHIVED é "escolha outra" no ticket, mas "reative a
// mãe" ao criar ou reativar a subcategoria. Casada como no mapa: TAG ou
// constraint na message, com as TAGs antes das constraints em cada lista (a TAG
// vence, como em mapTicketError); status e `code` continuam os do mapa. As
// checks só chegam aqui se o zod de schemas/catalog.ts deixar passar.
const CATALOG_OVERRIDES: Record<
  TicketCatalogErrorContext,
  ReadonlyArray<readonly [string, CatalogOverride]>
> = {
  product: [
    ["products_name_active_uidx", { field: "name" }],
    ["products_name_check", { field: "name", message: CATALOG_NAME_MESSAGE }],
    [
      "products_niche_check",
      { field: "niche", message: "Use até 80 caracteres no nicho, ou deixe em branco." },
    ],
    ["products_color_format_check", { field: "color", message: "Cor inválida." }],
  ],
  category_create: [
    ["CATEGORY_TOO_DEEP", { field: "parent_id" }],
    [
      "CATEGORY_ARCHIVED",
      { field: "parent_id", message: "Categoria mãe arquivada. Reative-a antes." },
    ],
    [
      "CATEGORY_PRODUCT_MISMATCH",
      { field: "parent_id", message: "A subcategoria fica na mesma fila da categoria mãe." },
    ],
    [
      "ticket_categories_parent_id_fkey",
      { field: "parent_id", message: "Categoria mãe não encontrada." },
    ],
    ["PRODUCT_ARCHIVED", { field: "product_id", message: "Fila arquivada. Reative-a antes." }],
    ["ticket_categories_name_active_uidx", { field: "name" }],
    ["ticket_categories_name_check", { field: "name", message: CATALOG_NAME_MESSAGE }],
    ["ticket_categories_product_id_fkey", { field: "product_id" }],
  ],
  category_update: [
    ["CATEGORY_HAS_ACTIVE_CHILDREN", { field: "archived" }],
    [
      "CATEGORY_ARCHIVED",
      { field: "archived", message: "Categoria mãe arquivada. Reative-a antes." },
    ],
    // Reativar categoria de fila arquivada (20260926120000_categoria_trava_mae).
    ["PRODUCT_ARCHIVED", { field: "archived", message: "Fila arquivada. Reative a fila antes." }],
    ["ticket_categories_name_active_uidx", { field: "name" }],
    ["ticket_categories_name_check", { field: "name", message: CATALOG_NAME_MESSAGE }],
  ],
  sla_policy: [
    [
      "sla_policies_first_response_check",
      { field: "first_response_minutes", message: SLA_MINUTES_MESSAGE },
    ],
    ["sla_policies_resolution_check", { field: "resolution_minutes", message: SLA_MINUTES_MESSAGE }],
    ["sla_policies_order_check", { field: "first_response_minutes" }],
    ["sla_policies_warn_pct_check", { field: "warn_pct", message: "Use de 1 a 99%." }],
  ],
  ticket_status: [
    ["ticket_statuses_label_uidx", { field: "label" }],
    [
      "ticket_statuses_label_check",
      { field: "label", message: "Informe um rótulo de até 40 caracteres." },
    ],
    ["ticket_statuses_color_check", { field: "color", message: "Cor inválida." }],
  ],
};

// Para o teste conferir cada TAG e constraint contra o mapa e as migrations.
export const TICKET_CATALOG_ERROR_NEEDLES: readonly string[] = Object.values(
  CATALOG_OVERRIDES
).flatMap((overrides) => overrides.map(([needle]) => needle));

/**
 * Erro do banco nas rotas de catálogo (fila, categoria, SLA e status): o mapa
 * de tickets, com o campo e a mensagem do formulário do catálogo. O campo de
 * ticket do mapa (category_id, product_id…) não passa: o formulário do
 * catálogo não o tem. O nome repetido sai como 409 `duplicate`, e a rota
 * acrescenta o item existente.
 */
export function mapCatalogError(
  error: DatabaseErrorLike | null | undefined,
  context: TicketCatalogErrorContext
): TicketCatalogError {
  const { status, code, message } = mapTicketError(error);
  const text = error?.message ?? "";
  const override = CATALOG_OVERRIDES[context].find(([needle]) => text.includes(needle))?.[1];
  if (!override) return { status, code, message };
  return { status, code, message: override.message ?? message, field: override.field };
}

/**
 * O corpo de erro das rotas de catálogo, no formato de ticketErrorBody: o campo
 * marcado em `errors` com a própria mensagem e, no 409 `duplicate`, o item que
 * já tem o nome. Nada do banco entra aqui.
 */
export function catalogErrorBody<Item>(
  error: TicketCatalogError,
  item?: Item
): TicketCatalogErrorBody<Item> {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    errors: error.field ? { [error.field]: [error.message] } : undefined,
    item,
  };
}
