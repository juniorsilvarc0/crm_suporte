import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { UazapiEnvelope } from "@/features/chat/lib/normalizers/uazapi";
import {
  claimOutbox,
  enqueueOutbox,
  outboxRetryAt,
  settleOutbox,
  type OutboxClaim,
} from "@/features/integrations/server/outbox";
import type { RelayMessage } from "@/features/integrations/server/relay-envelope";
import {
  envelopeLeaksToken,
  relayInboundMessage,
  type RelayDelivery,
} from "@/features/integrations/server/relay-message";
import type { Database, Json } from "@/lib/supabase/types";

// Dispatch do relay pela fila durável (Fase 6b-1b). O webhook ENFILEIRA a
// mensagem (síncrono, antes de responder → durável) e agenda uma tentativa
// imediata; o worker re-reivindica o que não saiu, dentro da janela. A entrega
// de UM evento reusa relayInboundMessage (sem token); o outbox dá o
// at-least-once (claim skip-locked + lease + backoff + dead_letter).

type Admin = SupabaseClient<Database>;

const RELAY_KIND = "relay" as const;
/** Quem drena a fila (lease_owner, informativo). */
const RELAY_OWNER = "relay-dispatch";
/** Tentativas antes do dead_letter — cabem na janela com o backoff. */
export const RELAY_MAX_ATTEMPTS = 6;
/** Depois disso a mensagem perde valor para a IA responder: vira dead_letter. */
export const RELAY_MAX_AGE_SECONDS = 120;
/** Eventos por drenagem (teto de entregas por ciclo/after). */
export const RELAY_CLAIM_LIMIT = 10;

/** O que fica guardado no outbox para entregar depois. Sem a credencial. */
const relayOutboxPayloadSchema = z.object({
  envelope: z.record(z.string(), z.unknown()),
  conversation_id: z.string(),
  contact_id: z.string(),
  message_id: z.string(),
  media: z.object({ bucket: z.string(), key: z.string() }).nullable(),
});

/** Tira o `token` da instância (em qualquer caixa) das chaves de raiz. */
function stripToken(payload: UazapiEnvelope): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...payload };
  for (const key of Object.keys(clone)) {
    if (key.trim().toLowerCase() === "token") delete clone[key];
  }
  return clone;
}

/**
 * Enfileira uma mensagem do cliente para o relay. Idempotente por `message_id`
 * (reenvio da uazapi não duplica). Tira o token da instância e CONFIRMA que ele
 * não sobrou aninhado: fail-closed — um envelope que traz a credencial não é
 * gravado nem entregue. Devolve se foi enfileirado.
 */
export async function enqueueRelay(supabase: Admin, delivery: RelayDelivery): Promise<boolean> {
  const envelope = stripToken(delivery.payload);
  if (envelopeLeaksToken(JSON.stringify(envelope), delivery.instanceToken)) {
    console.error("[relay] envelope com a credencial da instância: não enfileirado.", {
      messageId: delivery.messageId,
    });
    return false;
  }

  const payload = {
    envelope,
    conversation_id: delivery.conversationId,
    contact_id: delivery.contactId,
    message_id: delivery.messageId,
    media: delivery.media ? { bucket: delivery.media.bucket, key: delivery.media.key } : null,
  } as unknown as Json;

  const id = await enqueueOutbox(supabase, {
    kind: RELAY_KIND,
    eventKey: delivery.messageId,
    payload,
  });
  return id !== null;
}

/** Entrega um evento reivindicado e o finaliza (fencing pela lease). */
async function deliverRelayEvent(supabase: Admin, event: OutboxClaim): Promise<void> {
  // O claim sempre devolve a linha com lease; sem ela não há como finalizar.
  if (!event.lease_token) return;
  const leaseToken = event.lease_token;

  const parsed = relayOutboxPayloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    // Payload corrompido nunca vira entrega: mata o evento e registra.
    console.error("[relay] evento do outbox inválido:", event.id, parsed.error.message);
    await settleOutbox(supabase, {
      id: event.id,
      leaseToken,
      status: "dead_letter",
      error: "payload do outbox inválido",
    });
    return;
  }

  const message: RelayMessage = {
    payload: parsed.data.envelope as UazapiEnvelope,
    conversationId: parsed.data.conversation_id,
    contactId: parsed.data.contact_id,
    messageId: parsed.data.message_id,
    media: parsed.data.media,
  };

  // relayInboundMessage registra em integration_logs e devolve o desfecho.
  const outcome = await relayInboundMessage(supabase, message);

  if (!outcome) {
    // Sem agente configurado (ou falha já registrada no console): nada a reter.
    await settleOutbox(supabase, {
      id: event.id,
      leaseToken,
      status: "skipped",
      error: "sem agente configurado",
    });
    return;
  }

  if (outcome.error) {
    // Sem confirmação → retry DURÁVEL. O próximo prazo vem do backoff; o outbox
    // mata por idade (120s) ou tentativas, então não há retry infinito.
    await settleOutbox(supabase, {
      id: event.id,
      leaseToken,
      status: "retry",
      nextAttemptAt: outboxRetryAt(event.attempts, Date.now()),
      httpStatus: outcome.httpStatus ?? null,
      error: outcome.error,
    });
    return;
  }

  await settleOutbox(supabase, {
    id: event.id,
    leaseToken,
    status: "sent",
    httpStatus: outcome.httpStatus ?? null,
  });
}

/**
 * Drena uma leva de eventos de relay prontos: reivindica (skip-locked) e entrega
 * cada um. Todas as réplicas podem chamar à vontade — o claim serializa por
 * evento. Chamada pelo after() do webhook (imediato) e pelo worker (recuperação).
 */
export async function dispatchRelayBatch(supabase: Admin): Promise<void> {
  const claimed = await claimOutbox(supabase, {
    owner: RELAY_OWNER,
    kind: RELAY_KIND,
    limit: RELAY_CLAIM_LIMIT,
    maxAttempts: RELAY_MAX_ATTEMPTS,
    maxAgeSeconds: RELAY_MAX_AGE_SECONDS,
  });
  for (const event of claimed) {
    await deliverRelayEvent(supabase, event);
  }
}
