import type { ConnectionState } from "@/features/chat/lib/connection/uazapi";
import type { Database, IntegrationStatus } from "@/lib/supabase/types";

type IntegrationLogRow = Database["public"]["Tables"]["integration_logs"]["Row"];

// Colunas que a lista de registros lê. `payload` fica de fora: é dado interno
// do evento (ex.: o id de quem trocou a chave), e não vai à tela por padrão.
export type IntegrationLog = Pick<
  IntegrationLogRow,
  | "id"
  | "provider"
  | "direction"
  | "action"
  | "status"
  | "error"
  | "api_token_id"
  | "request_id"
  | "route"
  | "http_status"
  | "latency_ms"
  | "created_at"
>;

export const INTEGRATION_LOG_STATUSES = ["ok", "error"] as const satisfies readonly IntegrationStatus[];

/** Filtros da lista de registros. `null` = sem filtro naquele campo. */
export type IntegrationLogFilters = {
  provider: string | null;
  action: string | null;
  status: IntegrationStatus | null;
  requestId: string | null;
};

/**
 * Os registros mais recentes que casam com os filtros. `truncated` diz que há
 * mais linhas além do teto; `failed`, que a leitura falhou (a tela diz "não foi
 * possível carregar", e não "nenhum registro").
 */
export type IntegrationLogsResult = {
  logs: IntegrationLog[];
  truncated: boolean;
  failed: boolean;
};

/** Estado do WhatsApp visto pela Saúde. `unreachable` = a uazapi não respondeu. */
export type WhatsappHealth =
  | { state: "not_configured" }
  | { state: "unreadable" }
  | { state: "unreachable" }
  | { state: ConnectionState; connected: boolean };

/**
 * A Saúde das integrações, cada parte lida por conta própria: uma que falhe
 * vira `unreadable` e não derruba as outras.
 */
export type IntegrationHealth = {
  checkedAt: string;
  whatsapp: WhatsappHealth;
  /** A mensagem mais recente que chegou de um contato (`null` = nenhuma ainda). */
  lastInbound: { state: "ok"; at: string | null } | { state: "unreadable" };
  /**
   * Repasses de mensagem ao agente na janela (`conversation.message_received`;
   * o teste de conexão e a trilha da chave ficam de fora). `errorRate` é de 0 a
   * 1, e `null` quando não houve repasse.
   */
  relay:
    | { state: "ok"; windowHours: number; total: number; errors: number; errorRate: number | null }
    | { state: "unreadable" };
};
