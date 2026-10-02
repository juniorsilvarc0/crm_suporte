import type {
  IntegrationLogItem,
  IntegrationLogPeriod,
  IntegrationLogProvider,
} from "@/features/integrations/types";

// Como a tela chama o que o registro guarda em código. Neutro: a aba Registros
// (client) e os testes importam daqui. Valor que não está aqui aparece como
// veio: a tela não esconde uma linha só porque não conhece o rótulo.

export const INTEGRATION_PROVIDER_LABELS: Record<IntegrationLogProvider, string> = {
  api_v1: "API do CRM",
  relay: "Agente de IA",
};

const RELAY_ACTION_LABELS: Record<string, string> = {
  "conversation.message_received": "Repasse de mensagem",
  "webhook.ping": "Teste de conexão",
  "signing_secret.generated": "Chave gerada",
  "signing_secret.rotated": "Chave trocada",
  "signing_secret.removed": "Chave removida",
};

export const INTEGRATION_LOG_PERIOD_LABELS: Record<IntegrationLogPeriod, string> = {
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
};

export function integrationProviderLabel(provider: string): string {
  return INTEGRATION_PROVIDER_LABELS[provider as IntegrationLogProvider] ?? provider;
}

/** A ação como a tela a mostra. Na API é o método HTTP, que já se lê como está. */
export function integrationActionLabel(action: string | null): string {
  if (!action) return "—";
  return RELAY_ACTION_LABELS[action] ?? action;
}

/** Quem fez: o token da chamada, ou o usuário da trilha da chave. */
export function integrationLogAuthor(log: Pick<IntegrationLogItem, "token" | "actor">): string | null {
  if (log.token) return `${log.token.name} (${log.token.prefix}…)`;
  if (log.actor) return log.actor.name ?? "Usuário não identificado";
  return null;
}
