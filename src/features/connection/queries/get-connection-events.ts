import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConnectionState } from "@/features/chat/lib/connection/uazapi";
import type { ConnectionEvent, ConnectionStatus } from "@/features/connection/types";
import type { Database } from "@/lib/supabase/types";

type Admin = SupabaseClient<Database>;

// Leituras do monitor de conexão. Só o banco — nunca chamam o provedor —, então
// podem ser pedidas por toda aba aberta.

const STATES = new Set<string>(["open", "connecting", "close", "unknown"]);

function toEvent(row: { state: string; reason: string | null; occurred_at: string }): ConnectionEvent | null {
  return STATES.has(row.state)
    ? { state: row.state as ConnectionState, reason: row.reason, occurredAt: row.occurred_at }
    : null;
}

/** O id da integração ativa; `null` = nenhuma; `undefined` = a leitura falhou. */
async function activeIntegrationId(supabase: Admin): Promise<string | null | undefined> {
  // Só o id: o token mora no Vault e não é preciso aqui.
  const { data, error } = await supabase
    .from("chat_integrations")
    .select("id")
    .eq("provider", "uazapi")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[connection] integração ativa", error.code, error.message);
    return undefined;
  }
  return data?.id ?? null;
}

async function eventsOf(supabase: Admin, integrationId: string, limit: number): Promise<ConnectionEvent[] | null> {
  const { data, error } = await supabase
    .from("chat_connection_events")
    .select("state, reason, occurred_at")
    .eq("integration_id", integrationId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[connection] histórico", error.code, error.message);
    return null;
  }
  return (data ?? []).flatMap((row) => {
    const event = toEvent(row);
    return event ? [event] : [];
  });
}

/** O histórico mais recente (mais nova primeiro). `null` = a leitura falhou. */
export async function getConnectionEvents(supabase: Admin, limit: number): Promise<ConnectionEvent[] | null> {
  const integrationId = await activeIntegrationId(supabase);
  if (integrationId === undefined) return null;
  if (integrationId === null) return [];
  return eventsOf(supabase, integrationId, limit);
}

/** O estado atual segundo o monitor. `null` = a leitura falhou. */
export async function getConnectionStatus(supabase: Admin): Promise<ConnectionStatus | null> {
  const integrationId = await activeIntegrationId(supabase);
  if (integrationId === undefined) return null;
  if (integrationId === null) return { configured: false };
  const events = await eventsOf(supabase, integrationId, 1);
  if (events === null) return null;
  return { configured: true, current: events[0] ?? null };
}
