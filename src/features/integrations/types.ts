import type { ConnectionState } from "@/features/chat/lib/connection/uazapi";
import type { RelayConfig } from "@/features/settings/lib/get-relay-url";
import type { Database, IntegrationStatus } from "@/lib/supabase/types";
import type { ConnectionEvent } from "@/features/connection/types";
import { WEBHOOK_AUDIT_ACTIONS } from "@/features/webhooks/catalog";

export type IntegrationLog =
  Database["public"]["Tables"]["integration_logs"]["Row"];

// ---- Registros (aba da Conexão) ---------------------------------------------

/**
 * Quem grava em `integration_logs` hoje: a API v1 (`withApi`), o repasse ao
 * agente e a trilha dos destinos de webhook.
 */
export const INTEGRATION_LOG_PROVIDERS = ["api_v1", "relay", "webhooks"] as const;
export type IntegrationLogProvider = (typeof INTEGRATION_LOG_PROVIDERS)[number];

/**
 * As ações que cada integração grava: a API v1, o método HTTP; o repasse, o
 * evento. A tela monta o filtro daqui, e o parser só aceita o que está aqui.
 * `lib/log-filters.test.ts` confere a lista contra quem grava.
 */
export const INTEGRATION_LOG_ACTIONS = {
  api_v1: ["GET", "POST", "PUT", "PATCH"],
  relay: [
    "conversation.message_received",
    "webhook.ping",
    "signing_secret.generated",
    "signing_secret.rotated",
    "signing_secret.removed",
  ],
  // Vem do catálogo dos webhooks, que é de onde as rotas tiram a ação.
  webhooks: WEBHOOK_AUDIT_ACTIONS,
} as const satisfies Record<IntegrationLogProvider, readonly string[]>;
export type IntegrationLogAction = (typeof INTEGRATION_LOG_ACTIONS)[IntegrationLogProvider][number];

/**
 * A retenção prevista do registro é de 90 dias (D9 do plano da Fase 5), e não
 * há período maior a pedir. O expurgo em si só entra na Fase 6.
 */
export const INTEGRATION_LOG_PERIODS = ["24h", "7d", "30d", "90d"] as const;
export type IntegrationLogPeriod = (typeof INTEGRATION_LOG_PERIODS)[number];

/** Os filtros da lista. Cada chave é o nome do parâmetro na URL (ver lib/log-filters.ts). */
export type IntegrationLogFilters = {
  integracao: IntegrationLogProvider | null;
  status: IntegrationStatus | null;
  acao: IntegrationLogAction | null;
  // uuid do token (api_tokens.id). null = todos.
  token: string | null;
  // id do pedido (`request_id`): acha a linha exata, fora do período.
  pedido: string | null;
  periodo: IntegrationLogPeriod;
};

/**
 * Um registro como a tela o recebe. O `payload` da linha NUNCA sai: dele vem só
 * quem fez a ação (`actor`), quando a linha é da trilha da chave de assinatura.
 */
export type IntegrationLogItem = {
  id: string;
  created_at: string;
  provider: string;
  direction: "inbound" | "outbound" | null;
  action: string | null;
  status: IntegrationStatus | null;
  http_status: number | null;
  latency_ms: number | null;
  route: string | null;
  request_id: string | null;
  error: string | null;
  token: { id: string; name: string; prefix: string } | null;
  /** `name` nulo: o usuário não foi achado (ou a leitura dos nomes falhou). */
  actor: { id: string; name: string | null } | null;
};

export type IntegrationLogsPage =
  | { state: "ok"; items: IntegrationLogItem[]; nextCursor: string | null }
  // O cursor não saiu desta lista: quem chama decide (a rota responde 400).
  | { state: "invalid_cursor" }
  // A leitura falhou. Não é "nenhum registro".
  | { state: "unavailable" };

// ---- Saúde (aba da Conexão) -------------------------------------------------

/** Uma parte que pode não ter sido lida: `unavailable` não é zero nem "nunca". */
export type HealthPart<T> = ({ state: "ok" } & T) | { state: "unavailable" };

export type IntegrationHealth = {
  /** Quando esta leitura foi feita. Ela vale por alguns segundos para todos os pedidos. */
  generatedAt: string;
  /** Janela das contagens e das datas do repasse, em horas. */
  windowHours: number;
  whatsapp:
    | { state: "not_configured" }
    // `crm`: o CRM não conseguiu ler a integração (banco ou cofre).
    // `provider`: a integração foi lida, e o provedor não respondeu.
    | { state: "unavailable"; cause: "crm" | "provider"; instance: string | null }
    | { state: ConnectionState; instance: string | null };
  /**
   * O horário da mensagem recebida mais nova que ainda existe no CRM (apagada e
   * conversa limpa não contam). É o horário DA MENSAGEM, informado pelo
   * provedor, e não o da chegada ao CRM. `exact: false` = é um piso: a mais
   * nova é essa ou outra mais recente (ver getLastInboundAt).
   */
  lastInbound: HealthPart<{ at: string | null; exact: boolean }>;
  /**
   * As mudanças mais recentes do estado da conexão, gravadas pelo monitor
   * (worker), da mais nova para a mais antiga. Vazio = o monitor ainda não
   * gravou nada (ou não há instância).
   */
  connectionHistory: HealthPart<{ events: ConnectionEvent[] }>;
  relay: {
    config: RelayConfig["state"];
    /** Por que a URL salva é recusada, quando `config` é `refused`. */
    reason: string | null;
    /**
     * Só os repasses de mensagem da janela: o teste de conexão e a trilha da
     * chave ficam de fora. As datas também são da janela.
     */
    deliveries: HealthPart<{
      total: number;
      errors: number;
      lastOkAt: string | null;
      lastErrorAt: string | null;
    }>;
  };
  api: {
    /**
     * As chamadas REGISTRADAS na janela. Pedido sem token, barrado por excesso
     * ou a rota pública não entra no registro, e portanto não aparece aqui.
     * 4xx é erro de quem chama; 5xx é erro do CRM.
     */
    calls: HealthPart<{ total: number; clientErrors: number; serverErrors: number }>;
  };
  /**
   * Os webhooks de saída (Fase 6c): os destinos ativos agora; as entregas que
   * saíram e as que esgotaram na janela; as que estão em nova tentativa agora
   * (sem janela: é o que ainda vai sair); e a última entregue na janela.
   */
  webhooks: HealthPart<{
    activeDestinations: number;
    sent: number;
    dead: number;
    retrying: number;
    lastSentAt: string | null;
  }>;
};
