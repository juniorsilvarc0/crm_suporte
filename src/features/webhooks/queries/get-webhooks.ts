import type { SupabaseClient } from "@supabase/supabase-js";

import { isWebhookEvent } from "@/features/webhooks/catalog";
import type { WebhookDelivery, WebhookDeliveryStatus, WebhookSubscription } from "@/features/webhooks/types";
import type { Database } from "@/lib/supabase/types";

type Admin = SupabaseClient<Database>;

const DELIVERY_STATUSES = new Set<string>(["pending", "processing", "retry", "sent", "dead_letter", "skipped"]);

export const DELIVERIES_LIMIT = 50;

type SubscriptionRow = {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  secret_id: string | null;
  created_at: string;
  updated_at: string;
};

export function toWebhookSubscription(row: SubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    // Evento que saiu do catálogo (renomeado) não aparece, mas não quebra a tela.
    events: row.events.filter(isWebhookEvent),
    isActive: row.is_active,
    hasSecret: row.secret_id !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const SUBSCRIPTION_SELECT = "id, name, url, events, is_active, secret_id, created_at, updated_at";

/** Os destinos, do mais novo para o mais antigo. `null` = a leitura falhou. */
export async function getWebhookSubscriptions(supabase: Admin): Promise<WebhookSubscription[] | null> {
  const { data, error } = await supabase
    .from("webhook_subscriptions")
    .select(SUBSCRIPTION_SELECT)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[webhooks] destinos", error.code, error.message);
    return null;
  }
  return (data ?? []).map(toWebhookSubscription);
}

/**
 * As entregas mais recentes (linhas `webhook` do event_outbox), opcionalmente
 * de um destino e de um status. Nunca lê a lease. `null` = a leitura falhou.
 */
export async function getWebhookDeliveries(
  supabase: Admin,
  filter: { subscriptionId?: string; status?: WebhookDeliveryStatus } = {}
): Promise<WebhookDelivery[] | null> {
  let query = supabase
    .from("event_outbox")
    .select("id, payload, status, attempts, next_attempt_at, last_http_status, last_error, created_at, delivered_at")
    .eq("kind", "webhook");
  if (filter.subscriptionId) query = query.eq("payload->>subscription_id", filter.subscriptionId);
  if (filter.status) query = query.eq("status", filter.status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(DELIVERIES_LIMIT);
  if (error) {
    console.error("[webhooks] entregas", error.code, error.message);
    return null;
  }
  return (data ?? []).flatMap((row): WebhookDelivery[] => {
    if (!DELIVERY_STATUSES.has(row.status)) return [];
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : null);
    return [
      {
        id: row.id,
        subscriptionId: text("subscription_id"),
        event: text("event"),
        eventId: text("event_id"),
        status: row.status as WebhookDeliveryStatus,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        httpStatus: row.last_http_status,
        error: row.last_error,
        createdAt: row.created_at,
        deliveredAt: row.delivered_at,
      },
    ];
  });
}
