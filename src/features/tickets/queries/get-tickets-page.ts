import type { SupabaseClient } from "@supabase/supabase-js";

import { isContractStatus } from "@/features/contracts/lib/contract-status";
import { parseProtocolQuery } from "@/features/tickets/lib/protocol";
import { isTicketPriority } from "@/features/tickets/lib/ticket-priority";
import { isTicketStatus } from "@/features/tickets/lib/ticket-status";
import {
  TICKET_LIST_ORDERS,
  TICKET_LIST_SLA_FILTERS,
  TICKET_LIST_STATUS_GROUPS,
  type SlaMode,
  type TicketListItem,
  type TicketListOrder,
  type TicketListParams,
  type TicketListSlaFilter,
  type TicketListStatusGroup,
  type TicketSource,
  type TicketsPage,
} from "@/features/tickets/types";
import { searchTokens } from "@/lib/formatters/search-text";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { isUuid } from "@/lib/validation/uuid";

export const TICKETS_PAGE_SIZE = 25;

// Embeds com hint pelo NOME da FK: tickets tem duas relações com app_users
// (responsável e quem abriu) e, pela view, o embed sem hint responde PGRST201.
// O nome da FK também blinda os outros embeds contra uma relação nova no futuro.
// Conferido no PostgREST local (Fase 4, PR 2).
const TICKET_LIST_EMBEDS =
  "customer:customers!tickets_customer_id_fkey(id, legal_name, trade_name, contract_status), contact:contacts!tickets_contact_id_fkey(id, name, phone), product:products!tickets_product_id_fkey(id, name, color), assignee:app_users!tickets_assigned_to_user_id_fkey(id, name, avatar_color, avatar_url)";

// Colunas explícitas de propósito: description só no detalhe, e search_text,
// sla_breached e sla_at_risk só servem ao filtro (a tela recalcula o selo em
// lib/sla.ts). replied_after_resolve vem: o selo "Respondeu após resolver" usa o
// valor da view. ai_triage, idempotency_key e external_id nem estão na view.
export const TICKET_LIST_SELECT =
  `id, number, title, status, priority, version, source, conversation_id, is_terminal, reopened_count, sla_mode, sla_first_response_minutes, sla_resolution_minutes, sla_warn_pct, first_response_due_at, resolution_due_at, first_responded_at, sla_paused_at, resolved_at, closed_at, next_due_at, last_inbound_at, replied_after_resolve, created_at, updated_at, ${TICKET_LIST_EMBEDS}` as const;

const MAX_QUERY_LENGTH = 100;

const TICKET_SOURCES = ["ai", "agent", "api"] as const satisfies readonly TicketSource[];
const SLA_MODES = ["running", "paused", "stopped"] as const satisfies readonly SlaMode[];

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * As colunas de TICKET_LIST_SELECT como o PostgREST entrega. Numa view o
 * gerador de tipos marca tudo como anulável, e status, prioridade, origem e
 * modo chegam como texto: toTicketListItem confere cada um.
 */
export type TicketListRow = {
  id: string | null;
  number: number | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  version: number | null;
  source: string | null;
  conversation_id: string | null;
  is_terminal: boolean | null;
  reopened_count: number | null;
  sla_mode: string | null;
  sla_first_response_minutes: number | null;
  sla_resolution_minutes: number | null;
  sla_warn_pct: number | null;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_responded_at: string | null;
  sla_paused_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  next_due_at: string | null;
  last_inbound_at: string | null;
  replied_after_resolve: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  customer: {
    id: string;
    legal_name: string;
    trade_name: string | null;
    contract_status: string | null;
  } | null;
  contact: { id: string; name: string | null; phone: string } | null;
  product: { id: string; name: string; color: string } | null;
  assignee: { id: string; name: string; avatar_color: string; avatar_url: string | null } | null;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isStatusGroup(value: unknown): value is TicketListStatusGroup {
  return TICKET_LIST_STATUS_GROUPS.some((group) => group === value);
}

function isSlaFilter(value: unknown): value is TicketListSlaFilter {
  return TICKET_LIST_SLA_FILTERS.some((filter) => filter === value);
}

function isListOrder(value: unknown): value is TicketListOrder {
  return TICKET_LIST_ORDERS.some((order) => order === value);
}

function isTicketSource(value: unknown): value is TicketSource {
  return TICKET_SOURCES.some((source) => source === value);
}

function isSlaMode(value: unknown): value is SlaMode {
  return SLA_MODES.some((mode) => mode === value);
}

/**
 * Lê os filtros da URL de /app/tickets. Valor fora da allowlist vira o padrão
 * em vez de erro: link velho ou editado à mão abre a lista padrão ("ativos",
 * por prazo). Uuid de fila e de responsável sai em minúsculas.
 */
export function parseTicketListParams(searchParams: SearchParams): TicketListParams {
  const status = firstParam(searchParams.status);
  const prioridade = firstParam(searchParams.prioridade);
  const fila = firstParam(searchParams.fila);
  const responsavel = firstParam(searchParams.responsavel);
  const sla = firstParam(searchParams.sla);
  const ordem = firstParam(searchParams.ordem);
  const page = Number.parseInt(firstParam(searchParams.page) ?? "", 10);

  return {
    q: (firstParam(searchParams.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    status: isStatusGroup(status) || isTicketStatus(status) ? status : "ativos",
    prioridade: isTicketPriority(prioridade) ? prioridade : null,
    fila: fila === "sem" ? fila : isUuid(fila) ? fila.toLowerCase() : null,
    responsavel:
      responsavel === "eu" || responsavel === "nenhum"
        ? responsavel
        : isUuid(responsavel)
          ? responsavel.toLowerCase()
          : null,
    sla: isSlaFilter(sla) ? sla : null,
    ordem: isListOrder(ordem) ? ordem : "prazo",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** A leitura da view com as colunas da lista; filtro, ordem e página ficam com quem chama. */
export function selectTicketList(
  supabase: SupabaseClient<Database>,
  options: { count?: "exact"; head?: boolean } = {}
) {
  return supabase.from("ticket_queue").select(TICKET_LIST_SELECT, options);
}

export type TicketListQuery = ReturnType<typeof selectTicketList>;

/**
 * Ordem "prazo", a mesma da lista, do Início e dos tickets da conversa: o que
 * vence antes primeiro; relógio parado (next_due_at nulo: resolvido, ou pausado
 * depois da 1ª resposta) no fim; empate pela prioridade maior e pelo protocolo,
 * que é único e deixa a página estável entre um clique e outro.
 */
export function orderByDue(query: TicketListQuery): TicketListQuery {
  return query
    .order("next_due_at", { ascending: true, nullsFirst: false })
    .order("priority_rank", { ascending: false })
    .order("number", { ascending: true });
}

/**
 * Grupo "pendentes", o recorte da fila do Início: relógio correndo ou pausado,
 * MAIS o resolvido em que o cliente respondeu depois (replied_after_resolve, da
 * view: o PostgREST não compara coluna com coluna). A lista e getTicketQueue
 * usam este mesmo filtro: mesmo recorte, mesmo total no "Ver todos (N)".
 * Filtro estático: nada da URL entra no `.or()`.
 */
export function onlyPending(query: TicketListQuery): TicketListQuery {
  return query.or("sla_mode.neq.stopped,replied_after_resolve.is.true");
}

/**
 * Monta o item CAMPO A CAMPO, nunca com spread: coluna a mais que a consulta
 * traga (a descrição do detalhe, um campo de filtro) não chega ao payload.
 *
 * `null` = linha que o banco não deveria produzir (NOT NULL, FK e CHECK
 * garantem cada campo). Quem chama falha a leitura inteira em vez de esconder
 * o ticket: um ticket estourado que some da fila é pior que um aviso de erro.
 * Selo de contrato desconhecido vira `null`, como em toCustomerSummary.
 */
export function toTicketListItem(row: TicketListRow): TicketListItem | null {
  const { status, priority, source, sla_mode: slaMode, contact } = row;
  if (
    !isTicketStatus(status) ||
    !isTicketPriority(priority) ||
    !isTicketSource(source) ||
    !isSlaMode(slaMode) ||
    !contact ||
    row.id === null ||
    row.number === null ||
    row.title === null ||
    row.version === null ||
    row.conversation_id === null ||
    row.is_terminal === null ||
    row.reopened_count === null ||
    row.sla_first_response_minutes === null ||
    row.sla_resolution_minutes === null ||
    row.sla_warn_pct === null ||
    row.first_response_due_at === null ||
    row.resolution_due_at === null ||
    row.replied_after_resolve === null ||
    row.created_at === null ||
    row.updated_at === null
  ) {
    return null;
  }

  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status,
    priority,
    version: row.version,
    source,
    conversation_id: row.conversation_id,
    is_terminal: row.is_terminal,
    reopened_count: row.reopened_count,
    sla_mode: slaMode,
    sla_first_response_minutes: row.sla_first_response_minutes,
    sla_resolution_minutes: row.sla_resolution_minutes,
    sla_warn_pct: row.sla_warn_pct,
    first_response_due_at: row.first_response_due_at,
    resolution_due_at: row.resolution_due_at,
    first_responded_at: row.first_responded_at,
    sla_paused_at: row.sla_paused_at,
    resolved_at: row.resolved_at,
    closed_at: row.closed_at,
    next_due_at: row.next_due_at,
    last_inbound_at: row.last_inbound_at,
    replied_after_resolve: row.replied_after_resolve,
    created_at: row.created_at,
    updated_at: row.updated_at,
    customer: row.customer
      ? {
          id: row.customer.id,
          legal_name: row.customer.legal_name,
          trade_name: row.customer.trade_name,
          contract_status: isContractStatus(row.customer.contract_status)
            ? row.customer.contract_status
            : null,
        }
      : null,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    product: row.product
      ? { id: row.product.id, name: row.product.name, color: row.product.color }
      : null,
    assignee: row.assignee
      ? {
          id: row.assignee.id,
          name: row.assignee.name,
          avatar_color: row.assignee.avatar_color,
          avatar_url: row.assignee.avatar_url,
        }
      : null,
  };
}

/** Todas as linhas, ou `null` (logado) se alguma não fecha com o tipo. */
export function toTicketListItems(rows: TicketListRow[], context: string): TicketListItem[] | null {
  const items: TicketListItem[] = [];
  for (const row of rows) {
    const item = toTicketListItem(row);
    if (!item) {
      console.error(`${context}: linha inesperada`, row.id);
      return null;
    }
    items.push(item);
  }
  return items;
}

/**
 * Filtros da lista, sem ordem nem página: a contagem de socorro (ver
 * getTicketsPage) repete exatamente o mesmo recorte.
 *
 * Busca: protocolo ("SUP-1024", "#1024", "1024") vira `number = 1024`; o resto,
 * um `ilike` por token em search_text (título + contato + empresa, normalizados
 * no banco). Os tokens só têm [a-z0-9] — sem `.or()` e sem nada para escapar no
 * filtro do PostgREST. Fila e responsável só entram como uuid conferido.
 *
 * Protocolo IGNORA o status: quem digita "SUP-1024" quer aquele ticket, e o
 * padrão "ativos" esconderia o resolvido sem a pessoa ter escolhido filtro
 * nenhum. Os filtros que ela escolheu (prioridade, fila, responsável, SLA)
 * continuam valendo.
 */
function buildListQuery(
  supabase: SupabaseClient<Database>,
  params: TicketListParams,
  viewerId: string,
  head: boolean
): TicketListQuery {
  let query = selectTicketList(supabase, { count: "exact", head });

  const protocol = parseProtocolQuery(params.q);
  if (protocol !== null) {
    query = query.eq("number", protocol);
  } else {
    for (const token of searchTokens(params.q)) {
      query = query.ilike("search_text", `%${token}%`);
    }
  }

  switch (protocol === null ? params.status : "todos") {
    case "ativos":
      query = query.neq("sla_mode", "stopped");
      break;
    case "pendentes":
      query = onlyPending(query);
      break;
    case "resolvidos":
      query = query.eq("status", "resolvido");
      break;
    case "encerrados":
      query = query.eq("is_terminal", true);
      break;
    case "todos":
      break;
    default:
      query = query.eq("status", params.status);
  }

  if (params.prioridade) query = query.eq("priority", params.prioridade);

  if (params.fila === "sem") {
    query = query.is("product_id", null);
  } else if (isUuid(params.fila)) {
    query = query.eq("product_id", params.fila);
  }

  if (params.responsavel === "eu") {
    query = query.eq("assigned_to_user_id", viewerId);
  } else if (params.responsavel === "nenhum") {
    query = query.is("assigned_to_user_id", null);
  } else if (isUuid(params.responsavel)) {
    query = query.eq("assigned_to_user_id", params.responsavel);
  }

  switch (params.sla) {
    case "estourado":
      query = query.eq("sla_breached", true);
      break;
    case "risco":
      query = query.eq("sla_at_risk", true);
      break;
    case "pausado":
      query = query.eq("sla_mode", "paused");
      break;
  }

  return query;
}

function applyOrder(query: TicketListQuery, ordem: TicketListOrder): TicketListQuery {
  switch (ordem) {
    case "recentes":
      return query.order("created_at", { ascending: false }).order("number", { ascending: false });
    case "atualizados":
      return query.order("updated_at", { ascending: false }).order("number", { ascending: false });
    default:
      return orderByDue(query);
  }
}

/**
 * Paginação real server-side (`count: "exact"` + `range`), no molde de
 * getCustomersPage. `viewerId` resolve o filtro "responsável: eu".
 *
 * Leitura resiliente (AGENTS §4), mas com `failed`: erro loga e devolve página
 * vazia MARCADA, para a tela dizer "não foi possível carregar" em vez de
 * "nenhum ticket".
 */
export async function getTicketsPage(
  params: TicketListParams,
  viewerId: string
): Promise<TicketsPage> {
  const pageSize = TICKETS_PAGE_SIZE;
  const fetchedAt = new Date().toISOString();
  const failed = (page: number): TicketsPage => ({
    items: [],
    total: 0,
    page,
    pageSize,
    pageCount: 1,
    failed: true,
    fetchedAt,
  });

  if (!hasSupabaseAdminEnv()) return failed(params.page);

  try {
    const supabase = createSupabaseAdminClient();
    const fetchPage = (page: number) => {
      const from = (page - 1) * pageSize;
      return applyOrder(buildListQuery(supabase, params, viewerId, false), params.ordem).range(
        from,
        from + pageSize - 1
      );
    };

    let page = params.page;
    let result = await fetchPage(page);

    // Página além do fim (link antigo, ou o último ticket da página mudou de
    // status): com count, o PostgREST responde 416/PGRST103 em vez de lista
    // vazia. Conta de novo e abre a última página que existe — não é falha.
    if (result.error?.code === "PGRST103" && page > 1) {
      const { count, error } = await buildListQuery(supabase, params, viewerId, true);
      if (!error && count !== null) {
        page = Math.min(page, Math.max(1, Math.ceil(count / pageSize)));
        result = await fetchPage(page);
      }
    }

    // Offset exatamente igual ao total (ex.: 26 itens, página 2, o 26º sai):
    // o PostgREST responde 206 com lista VAZIA e o total na contagem, não 416.
    // Mesmo destino: a última página que existe — senão a tela diria
    // "nenhum ticket" com o contador mostrando o total.
    const emptyPastEnd =
      !result.error && page > 1 && (result.data?.length ?? 0) === 0 && (result.count ?? 0) > 0;
    if (emptyPastEnd) {
      page = Math.max(1, Math.ceil((result.count ?? 0) / pageSize));
      result = await fetchPage(page);
    }

    if (result.error) {
      console.error("getTicketsPage failed", result.error.message);
      return failed(page);
    }

    const items = toTicketListItems(result.data ?? [], "getTicketsPage");
    if (!items) return failed(page);

    const total = result.count ?? 0;
    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      failed: false,
      fetchedAt,
    };
  } catch (error) {
    console.error("getTicketsPage threw", error);
    return failed(params.page);
  }
}
