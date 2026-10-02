import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { getUazapiStatus } from "@/features/chat/lib/connection/uazapi";
import { RELAY_EVENT } from "@/features/integrations/server/relay-message";
import type { IntegrationHealth, WhatsappHealth } from "@/features/integrations/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Janela da taxa de erro do relay. */
export const RELAY_HEALTH_WINDOW_HOURS = 24;

/**
 * Estado da instância, só leitura: `/instance/status`, nunca `/instance/connect`.
 * Diferente de `GET /api/connection/state`, não grava o telefone do dono.
 *
 * "A uazapi não respondeu" (`unreachable`) é separado de "não deu para ler a
 * integração no banco" (`unreadable`). O texto do erro do provedor não sai
 * daqui: ele traz o corpo da resposta, e a Saúde só precisa do estado.
 */
async function whatsappHealth(supabase: Admin): Promise<WhatsappHealth> {
  let integration;
  try {
    integration = await getUazapiIntegration(supabase);
  } catch (error) {
    console.error("getIntegrationHealth: integração uazapi ilegível", error);
    return { state: "unreadable" };
  }
  if (!integration) return { state: "not_configured" };

  try {
    const status = await getUazapiStatus(integration.apiUrl, integration.token);
    return { state: status.state, connected: status.connected };
  } catch (error) {
    console.error("getIntegrationHealth: uazapi sem resposta", error);
    return { state: "unreachable" };
  }
}

async function lastInbound(supabase: Admin): Promise<IntegrationHealth["lastInbound"]> {
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("created_at")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { state: "ok", at: data?.created_at ?? null };
  } catch (error) {
    console.error("getIntegrationHealth: último inbound ilegível", error);
    return { state: "unreadable" };
  }
}

/**
 * Repasses de MENSAGEM na janela. Filtra pela ação: o teste de conexão
 * (`webhook.ping`) e a trilha da chave (`signing_secret.*`) também são do
 * provider `relay`, e contariam como repasse.
 */
async function relayHealth(supabase: Admin, now: Date): Promise<IntegrationHealth["relay"]> {
  const since = new Date(now.getTime() - RELAY_HEALTH_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const count = (status?: "error") => {
    let query = supabase
      .from("integration_logs")
      .select("id", { count: "exact", head: true })
      .eq("provider", "relay")
      .eq("action", RELAY_EVENT)
      .gte("created_at", since);
    if (status) query = query.eq("status", status);
    return query;
  };

  try {
    const [all, failed] = await Promise.all([count(), count("error")]);
    if (all.error) throw new Error(all.error.message);
    if (failed.error) throw new Error(failed.error.message);
    const total = all.count ?? 0;
    // As duas contagens não são um instante só: um repasse com erro gravado
    // entre uma e outra não pode dar taxa acima de 100%.
    const errors = Math.min(failed.count ?? 0, total);
    return {
      state: "ok",
      windowHours: RELAY_HEALTH_WINDOW_HOURS,
      total,
      errors,
      errorRate: total > 0 ? errors / total : null,
    };
  } catch (error) {
    console.error("getIntegrationHealth: registros do relay ilegíveis", error);
    return { state: "unreadable" };
  }
}

/**
 * A Saúde das integrações: o estado do WhatsApp, a última mensagem recebida e a
 * taxa de erro do repasse ao agente. Cada parte é lida por conta própria e em
 * paralelo; a que falhar vira `unreadable` sem derrubar as outras.
 *
 * Só para tela de administrador: quem chama confere o papel antes.
 */
export async function getIntegrationHealth(now: Date = new Date()): Promise<IntegrationHealth> {
  const checkedAt = now.toISOString();
  if (!hasSupabaseAdminEnv()) {
    return {
      checkedAt,
      whatsapp: { state: "unreadable" },
      lastInbound: { state: "unreadable" },
      relay: { state: "unreadable" },
    };
  }

  const supabase = createSupabaseAdminClient();
  const [whatsapp, inbound, relay] = await Promise.all([
    whatsappHealth(supabase),
    lastInbound(supabase),
    relayHealth(supabase, now),
  ]);
  return { checkedAt, whatsapp, lastInbound: inbound, relay };
}
