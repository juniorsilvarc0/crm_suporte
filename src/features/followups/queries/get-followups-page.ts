import type { SupabaseClient } from "@supabase/supabase-js";

import { isFollowupKind } from "@/features/followups/lib/followup-kind";
import { isFollowupStatus } from "@/features/followups/lib/followup-status";
import {
  FOLLOWUP_QUEUE_SITUATIONS,
  type FollowupQueueItem,
  type FollowupQueueParams,
  type FollowupQueueSituation,
  type FollowupsQueuePage,
} from "@/features/followups/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const FOLLOWUPS_PAGE_SIZE = 25;

// O ticket entra com `!inner` (todo retorno tem ticket: a FK é NOT NULL) para o
// filtro "Meus tickets" olhar o responsável dele. Hint pelo nome da FK: o
// `ticket_id` também se liga à view ticket_queue, e sem o hint é PGRST201.
export const FOLLOWUP_QUEUE_SELECT =
  "id, kind, status, due_at, notes, done_at, ticket:tickets!followups_ticket_id_fkey!inner(id, number, title, status, assigned_to_user_id, customer:customers!tickets_customer_id_fkey(id, legal_name, trade_name))";

type SearchParams = Record<string, string | string[] | undefined>;

type QueueRow = {
  id: string;
  kind: string;
  status: string;
  due_at: string;
  notes: string | null;
  done_at: string | null;
  ticket: {
    id: string;
    number: number;
    title: string;
    status: string;
    customer: { id: string; legal_name: string; trade_name: string | null } | null;
  } | null;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isQueueSituation(value: unknown): value is FollowupQueueSituation {
  return FOLLOWUP_QUEUE_SITUATIONS.some((situation) => situation === value);
}

/**
 * Lê os filtros da URL de /app/follow-ups. Valor fora da allowlist vira o
 * padrão (pendentes, de todos os tickets) em vez de erro: link velho ou editado
 * à mão abre a fila do dia.
 */
export function parseFollowupQueueParams(searchParams: SearchParams): FollowupQueueParams {
  const situacao = firstParam(searchParams.situacao);
  const page = Number.parseInt(firstParam(searchParams.page) ?? "", 10);

  return {
    situacao: isQueueSituation(situacao) ? situacao : "pendentes",
    responsavel: firstParam(searchParams.responsavel) === "eu" ? "eu" : "todos",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/**
 * Filtros da fila, sem ordem nem página: a contagem de socorro (ver
 * getFollowupsQueuePage) repete exatamente o mesmo recorte. "Vencido" é
 * pendente com prazo antes de `nowIso`, o mesmo instante que a tela recebe.
 */
function buildQueueQuery(
  supabase: SupabaseClient<Database>,
  params: FollowupQueueParams,
  viewerId: string,
  nowIso: string,
  head: boolean
) {
  let query = supabase.from("followups").select(FOLLOWUP_QUEUE_SELECT, { count: "exact", head });

  switch (params.situacao) {
    case "pendentes":
      query = query.eq("status", "pendente");
      break;
    case "vencidos":
      query = query.eq("status", "pendente").lt("due_at", nowIso);
      break;
    case "concluidos":
      query = query.eq("status", "concluido");
      break;
    case "cancelados":
      query = query.eq("status", "cancelado");
      break;
    case "todos":
      break;
  }

  if (params.responsavel === "eu") query = query.eq("ticket.assigned_to_user_id", viewerId);

  return query;
}

/** A linha como a tela consome, ou `null` se ela não fecha com o tipo. */
function toQueueItem(row: QueueRow): FollowupQueueItem | null {
  const ticket = row.ticket;
  if (!ticket || !isFollowupKind(row.kind) || !isFollowupStatus(row.status)) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    due_at: row.due_at,
    notes: row.notes,
    done_at: row.done_at,
    // Campo a campo: o `assigned_to_user_id` só serve ao filtro e não vai à tela.
    ticket: {
      id: ticket.id,
      number: ticket.number,
      title: ticket.title,
      status: ticket.status,
      customer: ticket.customer
        ? {
            id: ticket.customer.id,
            legal_name: ticket.customer.legal_name,
            trade_name: ticket.customer.trade_name,
          }
        : null,
    },
  };
}

/**
 * A fila de retornos, paginada no servidor (`count: "exact"` + `range`), no
 * molde de getContactsPage. Pendentes e vencidos saem do prazo mais próximo
 * (o mais atrasado primeiro); concluídos, cancelados e todos, do mais recente.
 * O `id` desempata para a página não repetir nem pular linha.
 *
 * Leitura resiliente (AGENTS §4), mas com `failed`: erro loga e devolve página
 * vazia MARCADA, para a tela não dizer "nenhum retorno" quando a leitura caiu.
 */
export async function getFollowupsQueuePage(
  params: FollowupQueueParams,
  viewerId: string
): Promise<FollowupsQueuePage> {
  const pageSize = FOLLOWUPS_PAGE_SIZE;
  const fetchedAt = new Date().toISOString();
  const failed = (page: number): FollowupsQueuePage => ({
    items: [],
    total: 0,
    page,
    pageSize,
    pageCount: 1,
    failed: true,
    fetchedAt,
  });

  if (!hasSupabaseAdminEnv()) return failed(params.page);

  const ascending = params.situacao === "pendentes" || params.situacao === "vencidos";

  try {
    const supabase = createSupabaseAdminClient();
    const fetchPage = (page: number) => {
      const from = (page - 1) * pageSize;
      return buildQueueQuery(supabase, params, viewerId, fetchedAt, false)
        .order("due_at", { ascending })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
    };

    let page = params.page;
    let result = await fetchPage(page);

    // Página além do fim (link antigo, ou o último retorno da página foi
    // concluído): com count, o PostgREST responde 416/PGRST103. Conta de novo e
    // abre a última página que existe — não é falha.
    if (result.error?.code === "PGRST103" && page > 1) {
      const { count, error } = await buildQueueQuery(supabase, params, viewerId, fetchedAt, true);
      if (!error && count !== null) {
        page = Math.min(page, Math.max(1, Math.ceil(count / pageSize)));
        result = await fetchPage(page);
      }
    }

    // Offset exatamente igual ao total: 206 com lista VAZIA e o total na
    // contagem, não 416. Mesmo destino: a última página que existe.
    const emptyPastEnd =
      !result.error && page > 1 && (result.data?.length ?? 0) === 0 && (result.count ?? 0) > 0;
    if (emptyPastEnd) {
      page = Math.max(1, Math.ceil((result.count ?? 0) / pageSize));
      result = await fetchPage(page);
    }

    if (result.error) {
      console.error("[followups] getFollowupsQueuePage", result.error.code, result.error.message);
      return failed(page);
    }

    const items: FollowupQueueItem[] = [];
    for (const row of (result.data ?? []) as unknown as QueueRow[]) {
      const item = toQueueItem(row);
      if (!item) {
        console.error("[followups] getFollowupsQueuePage: linha inesperada", row.id);
        return failed(page);
      }
      items.push(item);
    }

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
    console.error("[followups] getFollowupsQueuePage lançou", error);
    return failed(params.page);
  }
}
