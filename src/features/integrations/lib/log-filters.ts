import {
  INTEGRATION_LOG_ACTIONS,
  INTEGRATION_LOG_PERIODS,
  INTEGRATION_LOG_PROVIDERS,
  type IntegrationLogAction,
  type IntegrationLogFilters,
  type IntegrationLogPeriod,
  type IntegrationLogProvider,
} from "@/features/integrations/types";
import { firstParam, type SearchParams } from "@/lib/http/search-params";
import type { IntegrationStatus } from "@/lib/supabase/types";
import { isUuid } from "@/lib/validation/uuid";

// Os filtros da aba Registros moram na URL (UI.md §5.1). A tela escreve com
// `integrationLogSearch` e o servidor lê com `parseIntegrationLogFilters`: o que
// sai de um é o que o outro aceita. Neutro: a página, a rota e o componente
// client importam daqui (nada de módulo de servidor neste arquivo).

export const DEFAULT_INTEGRATION_LOG_FILTERS: IntegrationLogFilters = {
  integracao: null,
  status: null,
  acao: null,
  token: null,
  pedido: null,
  periodo: "7d",
};

// O id do pedido entra num `eq`. Hoje todo `request_id` gravado é um uuid; o
// alfabeto é um pouco mais largo (deixa passar um id de mensagem do provedor,
// se um dia for gravado) e o teto é o da coluna. O que importa é o que fica de
// fora: um NUL colado na URL chegaria ao Postgres, que o recusa, e a lista
// responderia 500.
const REQUEST_ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

const ALL_ACTIONS: readonly string[] = Object.values(INTEGRATION_LOG_ACTIONS).flat();
const actionsOf = (provider: IntegrationLogProvider): readonly string[] => INTEGRATION_LOG_ACTIONS[provider];

const isProvider = (value: unknown): value is IntegrationLogProvider =>
  INTEGRATION_LOG_PROVIDERS.includes(value as IntegrationLogProvider);
const isPeriod = (value: unknown): value is IntegrationLogPeriod =>
  INTEGRATION_LOG_PERIODS.includes(value as IntegrationLogPeriod);
const isAction = (value: unknown): value is IntegrationLogAction =>
  typeof value === "string" && ALL_ACTIONS.includes(value);
export const isIntegrationStatus = (value: unknown): value is IntegrationStatus =>
  value === "ok" || value === "error";

/**
 * Os filtros da URL. Valor que a lista não conhece é ignorado (cai no padrão),
 * como na lista de tickets: um link antigo não vira erro. Quem chama pela rota
 * recebe de volta os filtros que valeram.
 *
 * Com a integração escolhida, a ação tem de ser dela: `integracao=api_v1` com
 * `acao=webhook.ping` daria uma lista sempre vazia, e um select com valor fora
 * das opções.
 */
export function parseIntegrationLogFilters(searchParams: SearchParams): IntegrationLogFilters {
  const integracao = firstParam(searchParams.integracao);
  const status = firstParam(searchParams.status);
  const acao = firstParam(searchParams.acao);
  const token = firstParam(searchParams.token);
  const pedido = (firstParam(searchParams.pedido) ?? "").trim();
  const periodo = firstParam(searchParams.periodo);

  const provider = isProvider(integracao) ? integracao : null;
  const action = isAction(acao) && (provider === null || actionsOf(provider).includes(acao)) ? acao : null;

  return {
    integracao: provider,
    status: isIntegrationStatus(status) ? status : null,
    acao: action,
    token: isUuid(token) ? token.toLowerCase() : null,
    pedido: REQUEST_ID_RE.test(pedido) ? pedido : null,
    periodo: isPeriod(periodo) ? periodo : DEFAULT_INTEGRATION_LOG_FILTERS.periodo,
  };
}

/** Os parâmetros da URL, só os que fogem do padrão. O cursor não é filtro: vai à parte. */
export function integrationLogSearch(filters: IntegrationLogFilters): Record<string, string> {
  const search: Record<string, string> = {};
  if (filters.integracao) search.integracao = filters.integracao;
  if (filters.status) search.status = filters.status;
  if (filters.acao) search.acao = filters.acao;
  if (filters.token) search.token = filters.token;
  if (filters.pedido) search.pedido = filters.pedido;
  if (filters.periodo !== DEFAULT_INTEGRATION_LOG_FILTERS.periodo) search.periodo = filters.periodo;
  return search;
}
