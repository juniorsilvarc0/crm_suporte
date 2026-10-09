import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { getUazapiStatus } from "@/features/chat/lib/connection/uazapi";
import { getConnectionEvents } from "@/features/connection/queries/get-connection-events";
import { RELAY_EVENT } from "@/features/integrations/server/relay-message";
import type { IntegrationHealth } from "@/features/integrations/types";
import { getRelayConfig } from "@/features/settings/lib/get-relay-url";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbError = { code?: string; message?: string } | null;

/** Janela das contagens e das datas do repasse: as últimas 24 horas. */
export const HEALTH_WINDOW_HOURS = 24;
/** Por quanto tempo uma leitura serve a todos os pedidos (ver getIntegrationHealth). */
export const HEALTH_TTL_MS = 10_000;
// A última mensagem recebida é procurada nas conversas mais recentes.
const RECENT_CONVERSATIONS = 50;
/** Quantas mudanças de estado da conexão a aba mostra. */
export const CONNECTION_HISTORY_LIMIT = 10;

const unavailable = { state: "unavailable" } as const;
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : error);

// Na falha de rede o cliente devolve código e mensagem VAZIOS, e a contagem
// (HEAD) não tem corpo de erro: o status HTTP é o que sobra para o diagnóstico.
function logDbFailure(label: string, error: DbError, status?: number) {
  console.error(`getIntegrationHealth: ${label}`, error?.code, error?.message, status);
}

/**
 * Uma parte que LANÇA (o cliente rejeita, um bug) não derruba as outras: vira o
 * valor de reserva, com o motivo no log. As falhas previstas cada parte já trata.
 */
async function settle<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.error(`getIntegrationHealth: ${label}`, reasonOf(error));
    return fallback;
  }
}

/**
 * Estado da instância de WhatsApp, lido do provedor agora. Só LÊ: não grava o
 * telefone do dono (isso é de `/api/connection/state`) nem pede QR.
 */
async function whatsappHealth(supabase: Admin): Promise<IntegrationHealth["whatsapp"]> {
  let integration: Awaited<ReturnType<typeof getUazapiIntegration>>;
  try {
    integration = await getUazapiIntegration(supabase);
  } catch (error) {
    console.error("getIntegrationHealth: integração", reasonOf(error));
    return { state: "unavailable", cause: "crm", instance: null };
  }
  if (!integration) return { state: "not_configured" };

  try {
    const status = await getUazapiStatus(integration.apiUrl, integration.token);
    return { state: status.state, instance: status.owner ?? integration.phone_number };
  } catch (error) {
    // A mensagem do provedor pode trazer o corpo da resposta dele: fica no log.
    console.error("getIntegrationHealth: provedor", reasonOf(error));
    return { state: "unavailable", cause: "provider", instance: integration.phone_number };
  }
}

/**
 * O horário da mensagem recebida mais nova que ainda existe no CRM.
 *
 * Não há índice de `chat_messages` por data sozinha, e varrer a tabela a cada
 * abertura da aba não serve. O caminho barato: as conversas mais recentes
 * (`last_message_at`) e, dentro delas, a mensagem recebida mais nova (índice por
 * conversa).
 *
 * `last_message_at` é o máximo das mensagens da conversa. Então nenhuma conversa
 * de FORA das lidas tem mensagem mais nova que a atividade da última lida:
 * - veio menos conversa que o passo: todas foram lidas, e o que se achar é exato;
 * - passo cheio: só interessa mensagem a partir daquela atividade. Achou, é
 *   exato, e a consulta leu pouca linha;
 * - não achou (em 50 conversas seguidas, só o atendente escreveu por último):
 *   devolve a mais nova dessas conversas com `exact: false`. É um piso.
 *
 * Mensagem apagada não conta. Conversa limpa também não: limpar apaga as
 * mensagens e zera `last_message_at`.
 */
async function getLastInboundAt(supabase: Admin): Promise<IntegrationHealth["lastInbound"]> {
  const {
    data: conversations,
    error,
    status,
  } = await supabase
    .from("chat_conversations")
    .select("id, last_message_at")
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RECENT_CONVERSATIONS);
  if (error) {
    logDbFailure("conversas", error, status);
    return unavailable;
  }
  if (!conversations || conversations.length === 0) return { state: "ok", at: null, exact: true };

  const ids = conversations.map((conversation) => conversation.id);
  const newestInbound = (since: string | null) => {
    let query = supabase
      .from("chat_messages")
      .select("created_at")
      .eq("direction", "inbound")
      .eq("is_deleted", false)
      .in("conversation_id", ids);
    if (since) query = query.gte("created_at", since);
    return query.order("created_at", { ascending: false }).limit(1);
  };

  const allRead = conversations.length < RECENT_CONVERSATIONS;
  const oldestActivity = allRead ? null : conversations[conversations.length - 1].last_message_at;
  const proven = await newestInbound(oldestActivity);
  if (proven.error) {
    logDbFailure("mensagens", proven.error, proven.status);
    return unavailable;
  }
  const found = proven.data?.[0]?.created_at ?? null;
  if (allRead || found) return { state: "ok", at: found, exact: true };

  const floor = await newestInbound(null);
  if (floor.error) {
    logDbFailure("mensagens", floor.error, floor.status);
    return unavailable;
  }
  return { state: "ok", at: floor.data?.[0]?.created_at ?? null, exact: false };
}

function baseCount(supabase: Admin, since: string, provider: string) {
  return supabase
    .from("integration_logs")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .gte("created_at", since);
}

/** Quantas linhas do registro casam com o filtro, ou `null` se a contagem falhou. */
async function countLogs(
  supabase: Admin,
  since: string,
  provider: string,
  narrow: (query: ReturnType<typeof baseCount>) => ReturnType<typeof baseCount> = (query) => query
): Promise<number | null> {
  const { count, error, status } = await narrow(baseCount(supabase, since, provider));
  if (error || count === null) {
    logDbFailure("contagem", error, status);
    return null;
  }
  return count;
}

/**
 * O instante do último repasse da janela com o desfecho dado, ou `undefined` se
 * a leitura falhou. Tem janela porque `action` e `status` não estão em índice:
 * sem ela, um agente que nunca falhou faria a busca do último erro ler a tabela
 * toda.
 */
async function lastRelayAt(
  supabase: Admin,
  since: string,
  outcome: "ok" | "error"
): Promise<string | null | undefined> {
  const { data, error, status } = await supabase
    .from("integration_logs")
    .select("created_at")
    .eq("provider", "relay")
    .eq("action", RELAY_EVENT)
    .eq("status", outcome)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    logDbFailure("último repasse", error, status);
    return undefined;
  }
  return data?.[0]?.created_at ?? null;
}

/**
 * Repasses de mensagem ao agente. Filtra pela AÇÃO: o teste de conexão
 * (`webhook.ping`) e a trilha da chave (`signing_secret.*`) usam o mesmo
 * provider e não são entregas.
 */
async function relayDeliveries(
  supabase: Admin,
  since: string
): Promise<IntegrationHealth["relay"]["deliveries"]> {
  const [total, errors, lastOkAt, lastErrorAt] = await Promise.all([
    countLogs(supabase, since, "relay", (query) => query.eq("action", RELAY_EVENT)),
    countLogs(supabase, since, "relay", (query) => query.eq("action", RELAY_EVENT).eq("status", "error")),
    lastRelayAt(supabase, since, "ok"),
    lastRelayAt(supabase, since, "error"),
  ]);
  if (total === null || errors === null || lastOkAt === undefined || lastErrorAt === undefined) {
    return unavailable;
  }
  return { state: "ok", total, errors, lastOkAt, lastErrorAt };
}

/** Chamadas registradas da API v1: 4xx é erro de quem chama; 5xx é erro do CRM. */
async function apiCalls(supabase: Admin, since: string): Promise<IntegrationHealth["api"]["calls"]> {
  const [total, clientErrors, serverErrors] = await Promise.all([
    countLogs(supabase, since, "api_v1"),
    countLogs(supabase, since, "api_v1", (query) => query.gte("http_status", 400).lt("http_status", 500)),
    countLogs(supabase, since, "api_v1", (query) => query.gte("http_status", 500)),
  ]);
  if (total === null || clientErrors === null || serverErrors === null) return unavailable;
  return { state: "ok", total, clientErrors, serverErrors };
}

/**
 * Lê a saúde das integrações agora. Cada parte falha sozinha, e falha dizendo
 * que falhou: contagem que não foi lida não vira zero. Nunca rejeita.
 */
export async function readIntegrationHealth(now: Date = new Date()): Promise<IntegrationHealth> {
  const generatedAt = now.toISOString();

  let supabase: Admin | null = null;
  if (hasSupabaseAdminEnv()) {
    try {
      supabase = createSupabaseAdminClient();
    } catch (error) {
      console.error("getIntegrationHealth: cliente", reasonOf(error));
    }
  }
  if (!supabase) {
    // Sem banco, nada foi lido: nem a configuração do agente.
    return {
      generatedAt,
      windowHours: HEALTH_WINDOW_HOURS,
      whatsapp: { state: "unavailable", cause: "crm", instance: null },
      lastInbound: unavailable,
      connectionHistory: unavailable,
      relay: { config: "unreadable", reason: null, deliveries: unavailable },
      api: { calls: unavailable },
    };
  }

  const admin = supabase;
  const since = new Date(now.getTime() - HEALTH_WINDOW_HOURS * 3_600_000).toISOString();
  const [relay, whatsapp, lastInbound, deliveries, calls, connectionHistory] = await Promise.all([
    settle<Pick<IntegrationHealth["relay"], "config" | "reason">>(
      "agente",
      async () => {
        const config = await getRelayConfig();
        return { config: config.state, reason: config.reason };
      },
      { config: "unreadable", reason: null }
    ),
    settle<IntegrationHealth["whatsapp"]>("whatsapp", () => whatsappHealth(admin), {
      state: "unavailable",
      cause: "crm",
      instance: null,
    }),
    settle<IntegrationHealth["lastInbound"]>("última mensagem", () => getLastInboundAt(admin), unavailable),
    settle<IntegrationHealth["relay"]["deliveries"]>("repasse", () => relayDeliveries(admin, since), unavailable),
    settle<IntegrationHealth["api"]["calls"]>("api", () => apiCalls(admin, since), unavailable),
    settle<IntegrationHealth["connectionHistory"]>(
      "histórico da conexão",
      async () => {
        const events = await getConnectionEvents(admin, CONNECTION_HISTORY_LIMIT);
        return events === null ? unavailable : { state: "ok", events };
      },
      unavailable
    ),
  ]);

  return {
    generatedAt,
    windowHours: HEALTH_WINDOW_HOURS,
    whatsapp,
    lastInbound,
    connectionHistory,
    relay: { ...relay, deliveries },
    api: { calls },
  };
}

// Uma leitura custa uma chamada ao provedor e uma dúzia de consultas, e a rota
// que a serve é GET (fora da trava de origem do proxy): uma aba em laço, ou uma
// página de outra origem do mesmo site, a dispararia à vontade. Por isso a
// leitura em curso serve a todos os pedidos, e o resultado vale por
// HEALTH_TTL_MS neste processo. A resposta leva `generatedAt`.
let latest: { startedAt: number; health: Promise<IntegrationHealth> } | null = null;

/** A saúde das integrações, para a aba da Conexão (ver readIntegrationHealth). */
export function getIntegrationHealth(now: Date = new Date()): Promise<IntegrationHealth> {
  const age = latest ? now.getTime() - latest.startedAt : -1;
  if (latest && age >= 0 && age < HEALTH_TTL_MS) return latest.health;

  const health = readIntegrationHealth(now);
  latest = { startedAt: now.getTime(), health };
  return health;
}
