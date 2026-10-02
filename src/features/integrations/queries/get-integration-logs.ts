import { olderThanFilter, takePage } from "@/features/chat/lib/messages-page";
import { isIntegrationStatus } from "@/features/integrations/lib/log-filters";
import type {
  IntegrationLogFilters,
  IntegrationLogItem,
  IntegrationLogPeriod,
  IntegrationLogsPage,
} from "@/features/integrations/types";
import { decodeLogCursor, encodeLogCursor } from "@/lib/api/v1/cursor";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const INTEGRATION_LOGS_PAGE_SIZE = 50;

const PERIOD_HOURS: Record<IntegrationLogPeriod, number> = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
  "90d": 90 * 24,
};

// Colunas explícitas: o `payload` não vem. Dele só interessa quem fez a ação
// (`payload.by`, que a trilha da chave de assinatura grava), e o PostgREST o
// extrai. Do token, o nome e o prefixo: nunca o hash.
const LOG_LIST_SELECT =
  "id, created_at, provider, direction, action, status, http_status, latency_ms, route, request_id, error, actor_id:payload->>by, token:api_tokens!integration_logs_api_token_id_fkey(id, name, token_prefix)" as const;

type LogListRow = {
  id: string;
  created_at: string;
  provider: string;
  direction: string | null;
  action: string | null;
  status: string | null;
  http_status: number | null;
  latency_ms: number | null;
  route: string | null;
  request_id: string | null;
  error: string | null;
  actor_id: string | null;
  token: { id: string; name: string; token_prefix: string } | null;
};

function toItem(row: LogListRow, actors: Map<string, string>): IntegrationLogItem {
  return {
    id: row.id,
    created_at: row.created_at,
    provider: row.provider,
    direction: row.direction === "inbound" || row.direction === "outbound" ? row.direction : null,
    action: row.action,
    status: isIntegrationStatus(row.status) ? row.status : null,
    http_status: row.http_status,
    latency_ms: row.latency_ms,
    route: row.route,
    request_id: row.request_id,
    error: row.error,
    token: row.token
      ? { id: row.token.id, name: row.token.name, prefix: row.token.token_prefix }
      : null,
    // `payload.by` é texto livre no banco: só um uuid é tratado como usuário.
    actor: isUuid(row.actor_id)
      ? { id: row.actor_id, name: actors.get(row.actor_id) ?? null }
      : null,
  };
}

/**
 * Uma página dos registros de integração, do mais novo para o mais antigo.
 *
 * Paginação por cursor (`created_at`, `id`), sem `count`: a tabela ganha uma
 * linha a cada chamada da API, e contar a cada página custaria uma varredura.
 * `cursor` é o `nextCursor` da página anterior, e não faz parte dos filtros.
 *
 * Quem procura por id de pedido quer aquela linha: o período é ignorado, como o
 * protocolo ignora o status na lista de tickets. Os outros filtros valem.
 *
 * A leitura que falha devolve `unavailable`, e não uma lista vazia: numa tela
 * de diagnóstico, "nenhum registro" quando o banco não respondeu é mentira.
 * Nunca rejeita.
 */
export async function getIntegrationLogs(
  filters: IntegrationLogFilters,
  cursor: string | null = null,
  now: Date = new Date()
): Promise<IntegrationLogsPage> {
  if (!hasSupabaseAdminEnv()) return { state: "unavailable" };

  const after = cursor === null ? null : decodeLogCursor(cursor);
  if (cursor !== null && after === null) return { state: "invalid_cursor" };

  try {
    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from("integration_logs")
      .select(LOG_LIST_SELECT)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(INTEGRATION_LOGS_PAGE_SIZE + 1);

    if (filters.pedido) {
      query = query.eq("request_id", filters.pedido);
    } else {
      const since = new Date(now.getTime() - PERIOD_HOURS[filters.periodo] * 3_600_000);
      query = query.gte("created_at", since.toISOString());
    }
    if (filters.integracao) query = query.eq("provider", filters.integracao);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.acao) query = query.eq("action", filters.acao);
    if (filters.token) query = query.eq("api_token_id", filters.token);
    if (after) {
      // O `lte` é redundante com o `.or()`, e é ele que o índice usa como limite:
      // sem ele, cada página releria do topo do período até o cursor. O cursor
      // passou por `decodeLogCursor` (instante e uuid conferidos): nada a escapar.
      query = query.lte("created_at", after.createdAt).or(olderThanFilter(after));
    }

    const { data, error } = await query;
    if (error) {
      console.error("getIntegrationLogs failed", error.code, error.message);
      return { state: "unavailable" };
    }

    const rows: LogListRow[] = data ?? [];
    const { page, hasMore } = takePage(rows, INTEGRATION_LOGS_PAGE_SIZE);
    const actors = await actorNames(
      supabase,
      page.map((row) => row.actor_id)
    );

    return {
      state: "ok",
      items: page.map((row) => toItem(row, actors)),
      nextCursor: hasMore ? encodeLogCursor(page[page.length - 1]) : null,
    };
  } catch (error) {
    console.error("getIntegrationLogs failed", error instanceof Error ? error.message : error);
    return { state: "unavailable" };
  }
}

/**
 * Nome de quem fez cada ação da página. Se a leitura falhar, a página sai sem
 * os nomes (o id continua lá): o registro vale mais que o rótulo.
 */
async function actorNames(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(isUuid))];
  if (unique.length === 0) return new Map();

  try {
    const { data, error } = await supabase.from("app_users").select("id, name").in("id", unique);
    if (error) {
      console.error("getIntegrationLogs: nomes dos usuários", error.code, error.message);
      return new Map();
    }
    return new Map((data ?? []).map((user) => [user.id, user.name]));
  } catch (error) {
    console.error("getIntegrationLogs: nomes dos usuários", error instanceof Error ? error.message : error);
    return new Map();
  }
}
