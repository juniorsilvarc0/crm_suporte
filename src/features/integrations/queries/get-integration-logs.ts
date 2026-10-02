import {
  INTEGRATION_LOG_STATUSES,
  type IntegrationLogFilters,
  type IntegrationLogsResult,
} from "@/features/integrations/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { IntegrationStatus } from "@/lib/supabase/types";

/** Teto de linhas por leitura. A tela estreita pelos filtros, não pagina. */
export const INTEGRATION_LOGS_LIMIT = 200;

// As colunas de `IntegrationLog`, sem `payload`.
export const INTEGRATION_LOG_SELECT =
  "id, provider, direction, action, status, error, api_token_id, request_id, route, http_status, latency_ms, created_at";

// Formas que as colunas têm de fato: provider (`relay`, `api_v1`), action
// (`conversation.message_received`, `signing_secret.rotated`, `GET`) e o
// request_id (uuid, ou o id da mensagem do provedor). Valor fora disso não
// casa com linha nenhuma, e vira "sem filtro" em vez de erro: link velho ou
// editado à mão abre a lista inteira.
const PROVIDER_RE = /^[a-z0-9_]{1,40}$/;
const ACTION_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function matching(value: string | undefined, pattern: RegExp): string | null {
  const trimmed = value?.trim() ?? "";
  return pattern.test(trimmed) ? trimmed : null;
}

function isIntegrationStatus(value: unknown): value is IntegrationStatus {
  return INTEGRATION_LOG_STATUSES.some((status) => status === value);
}

/** Lê os filtros da URL da aba Logs (`integracao`, `acao`, `status`, `request_id`). */
export function parseIntegrationLogFilters(searchParams: SearchParams): IntegrationLogFilters {
  const status = firstParam(searchParams.status);
  return {
    provider: matching(firstParam(searchParams.integracao), PROVIDER_RE),
    action: matching(firstParam(searchParams.acao), ACTION_RE),
    status: isIntegrationStatus(status) ? status : null,
    requestId: matching(firstParam(searchParams.request_id), REQUEST_ID_RE),
  };
}

export const NO_INTEGRATION_LOG_FILTERS: IntegrationLogFilters = {
  provider: null,
  action: null,
  status: null,
  requestId: null,
};

/**
 * Os registros mais recentes que casam com os filtros, do mais novo para o mais
 * antigo, até `INTEGRATION_LOGS_LIMIT`. Pede uma linha a mais: ela diz que há
 * mais registros sem um `count` sobre a tabela inteira.
 *
 * Filtro por igualdade (`eq`), nunca `ilike` nem `.or()`: o valor já passou
 * pela forma da coluna e não tem nada a escapar. Integração + data usa o índice
 * `integration_logs_provider_created_at_idx`, e o request_id, o dele.
 *
 * Leitura resiliente (AGENTS §4), com `failed` para a tela distinguir a falha
 * da lista vazia.
 */
export async function getIntegrationLogs(
  filters: IntegrationLogFilters = NO_INTEGRATION_LOG_FILTERS
): Promise<IntegrationLogsResult> {
  const failed: IntegrationLogsResult = { logs: [], truncated: false, failed: true };
  if (!hasSupabaseAdminEnv()) return failed;

  try {
    const supabase = createSupabaseAdminClient();
    let query = supabase.from("integration_logs").select(INTEGRATION_LOG_SELECT);
    if (filters.provider) query = query.eq("provider", filters.provider);
    if (filters.action) query = query.eq("action", filters.action);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.requestId) query = query.eq("request_id", filters.requestId);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(INTEGRATION_LOGS_LIMIT + 1);

    if (error) {
      console.error("getIntegrationLogs failed", error.message);
      return failed;
    }

    const rows = data ?? [];
    return {
      // Campo a campo, nunca com spread: coluna a mais que a consulta traga
      // não chega ao payload da página.
      logs: rows.slice(0, INTEGRATION_LOGS_LIMIT).map((row) => ({
        id: row.id,
        provider: row.provider,
        direction: row.direction,
        action: row.action,
        status: row.status,
        error: row.error,
        api_token_id: row.api_token_id,
        request_id: row.request_id,
        route: row.route,
        http_status: row.http_status,
        latency_ms: row.latency_ms,
        created_at: row.created_at,
      })),
      truncated: rows.length > INTEGRATION_LOGS_LIMIT,
      failed: false,
    };
  } catch (error) {
    console.error("getIntegrationLogs threw", error);
    return failed;
  }
}
