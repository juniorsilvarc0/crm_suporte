import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { claimOutbox, settleOutbox, type OutboxClaim } from "@/features/integrations/server/outbox";
import { getApiTicket } from "@/features/tickets/queries/get-api-ticket";
import { postWebhook } from "@/features/webhooks/server/send";
import { assertSafeUrl } from "@/lib/security/ssrf-guard";
import type { Database } from "@/lib/supabase/types";

// Despachante dos webhooks de saída (Fase 6c-2). Os gatilhos do banco (6c-1)
// enfileiram uma linha `webhook` por destino e evento; o worker drena a fila:
// reivindica (skip locked, lease de 2 min), monta o corpo com o ticket ATUAL,
// assina e envia. Entrega pelo menos uma vez: quem recebe deduplica pelo `id`
// do corpo (a assinatura não cobre cabeçalhos) e ordena pela `version` do
// ticket. Contrato: docs/CONTRATO-WEBHOOKS.md.

type Admin = SupabaseClient<Database>;

const WEBHOOK_KIND = "webhook" as const;
const WEBHOOK_OWNER = "webhook-dispatch";
/** Tentativas antes do dead_letter (critério da Fase 6 no plano). */
export const WEBHOOK_MAX_ATTEMPTS = 8;
/** Velho demais para ainda servir: 3 dias (cobre o backoff inteiro). */
export const WEBHOOK_MAX_AGE_SECONDS = 3 * 24 * 60 * 60;
/**
 * Entregas por ciclo. Com 10 s de prazo cada, 5 em série cabem folgadas na
 * lease de 2 minutos — outra réplica não reivindica no meio do envio.
 */
export const WEBHOOK_CLAIM_LIMIT = 5;

// Backoff 30 s → 2 min → 8 min → 32 min → ~2 h → ~8,5 h → 24 h (teto).
export const WEBHOOK_BACKOFF_BASE_MS = 30_000;
export const WEBHOOK_BACKOFF_CAP_MS = 24 * 60 * 60_000;

/** Quando sai a próxima tentativa, dada a tentativa que acabou de falhar (1, 2, …). */
export function webhookRetryAt(attempts: number, nowMs: number): string {
  const n = Math.max(1, attempts);
  const delay = Math.min(WEBHOOK_BACKOFF_CAP_MS, WEBHOOK_BACKOFF_BASE_MS * 4 ** (n - 1));
  return new Date(nowMs + delay).toISOString();
}

/** O que o gatilho `webhook_emit` grava no outbox. */
const payloadSchema = z.object({
  subscription_id: z.string(),
  event: z.string(),
  event_id: z.string(),
  occurred_at: z.string(),
  data: z.record(z.string(), z.unknown()),
});

type Settle = Parameters<typeof settleOutbox>[1];

/** Entrega um evento reivindicado e o finaliza (fencing pela lease). */
export async function deliverWebhookEvent(supabase: Admin, event: OutboxClaim): Promise<Settle["status"] | null> {
  if (!event.lease_token) return null;
  const leaseToken = event.lease_token;
  const settle = async (input: Omit<Settle, "id" | "leaseToken">) => {
    await settleOutbox(supabase, { id: event.id, leaseToken, ...input });
    return input.status;
  };

  const parsed = payloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    console.error("[webhooks] evento do outbox inválido:", event.id);
    return settle({ status: "dead_letter", error: "payload do outbox inválido" });
  }
  const payload = parsed.data;

  const { data: subscription, error: subscriptionError } = await supabase
    .from("webhook_subscriptions")
    .select("id, url, is_active")
    .eq("id", payload.subscription_id)
    .maybeSingle();
  if (subscriptionError) {
    return settle({ status: "retry", nextAttemptAt: webhookRetryAt(event.attempts, Date.now()), error: "não foi possível ler o destino" });
  }
  // Destino apagado ou pausado depois de enfileirar: nada a entregar.
  if (!subscription) return settle({ status: "skipped", error: "destino removido" });
  if (!subscription.is_active) return settle({ status: "skipped", error: "destino pausado" });

  let target: URL;
  try {
    target = assertSafeUrl(subscription.url);
  } catch (error) {
    return settle({ status: "dead_letter", error: `URL recusada: ${error instanceof Error ? error.message : "inválida"}` });
  }

  const { data: secret, error: secretError } = await supabase.rpc("get_webhook_subscription_secret", {
    p_subscription_id: subscription.id,
  });
  if (secretError) {
    return settle({ status: "retry", nextAttemptAt: webhookRetryAt(event.attempts, Date.now()), error: "não foi possível ler o segredo" });
  }
  // Sem segredo não sai: um evento sem assinatura qualquer um forjaria igual.
  if (!secret) return settle({ status: "dead_letter", error: "destino sem segredo de assinatura" });

  // O ticket ATUAL (formato da API v1). Ticket que sumiu vai como null; erro
  // de leitura tenta de novo — nunca sai um corpo pela metade.
  let ticket: Awaited<ReturnType<typeof getApiTicket>> = null;
  const ticketId = typeof payload.data.ticket_id === "string" ? payload.data.ticket_id : null;
  if (ticketId) {
    try {
      ticket = await getApiTicket(supabase, { id: ticketId });
    } catch {
      return settle({ status: "retry", nextAttemptAt: webhookRetryAt(event.attempts, Date.now()), error: "não foi possível ler o ticket" });
    }
  }

  const body = JSON.stringify({
    id: payload.event_id,
    event: payload.event,
    occurred_at: payload.occurred_at,
    data: payload.data,
    ticket,
  });
  const outcome = await postWebhook(target, secret, { name: payload.event, id: payload.event_id, body });

  if (outcome.error) {
    return settle({
      status: "retry",
      nextAttemptAt: webhookRetryAt(event.attempts, Date.now()),
      httpStatus: outcome.httpStatus ?? null,
      error: outcome.error,
    });
  }
  return settle({ status: "sent", httpStatus: outcome.httpStatus ?? null });
}

/**
 * Drena uma leva de webhooks prontos. Todas as réplicas podem chamar: o claim
 * serializa por evento. Esgotados (8 tentativas) ou velhos (3 dias) viram
 * dead_letter no próprio claim; o reenvio manual é `outbox_requeue`.
 */
export async function dispatchWebhookBatch(supabase: Admin): Promise<void> {
  const claimed = await claimOutbox(supabase, {
    owner: WEBHOOK_OWNER,
    kind: WEBHOOK_KIND,
    limit: WEBHOOK_CLAIM_LIMIT,
    maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    maxAgeSeconds: WEBHOOK_MAX_AGE_SECONDS,
  });
  for (const event of claimed) {
    await deliverWebhookEvent(supabase, event);
  }
}
