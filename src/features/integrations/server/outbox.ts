import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/types";

// Helpers da fila durável de entrega (Fase 6b). Envolvem as RPCs
// outbox_enqueue/claim/settle (migration 20261008140000) — a tabela só é escrita
// por elas (service_role tem só EXECUTE). Esta PR entrega a INFRA; o relay migra
// para cá na 6b-1b. Nenhum helper lança: erro de banco vira log + retorno neutro,
// como o padrão de leitura resiliente do projeto.

type Admin = SupabaseClient<Database>;

/** Um evento reivindicado da fila, pronto para o worker tentar entregar. */
export type OutboxClaim = Database["public"]["Functions"]["outbox_claim"]["Returns"][number];

/** Tipos de evento da fila — espelha o check do banco (event_outbox_kind_check). */
export type OutboxKind = "relay" | "webhook";

/** Desfecho que o worker informa ao finalizar — espelha o guard de outbox_settle. */
export type OutboxSettleStatus = "sent" | "retry" | "dead_letter" | "skipped";

// Backoff exponencial com teto para o next_attempt_at de uma reentrega, no molde
// do outbox de conversões do projeto irmão: base · 2^(n-1), limitado ao teto. O
// worker calcula e passa pronto (o banco não decide o quando). Para o relay o
// teto é curto de propósito: a janela útil da mensagem é 120s.
export const OUTBOX_BACKOFF_BASE_MS = 5_000;
export const OUTBOX_BACKOFF_CAP_MS = 60_000;

/**
 * Quando a próxima tentativa deve sair, em ISO, dado o nº de tentativas já feitas
 * (`attempts` do evento) e o instante atual em ms. Puro e determinístico para o
 * teste; o worker passa `Date.now()`.
 */
export function outboxRetryAt(attempts: number, nowMs: number): string {
  const n = Math.max(1, attempts);
  const delay = Math.min(OUTBOX_BACKOFF_CAP_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** (n - 1));
  return new Date(nowMs + delay).toISOString();
}

/** Enfileira um evento (idempotente por kind+event_key). Devolve o id ou null. */
export async function enqueueOutbox(
  supabase: Admin,
  input: { kind: OutboxKind; eventKey: string; payload: Json }
): Promise<string | null> {
  const { data, error } = await supabase.rpc("outbox_enqueue", {
    p_kind: input.kind,
    p_event_key: input.eventKey,
    p_payload: input.payload,
  });
  if (error) {
    console.error("[outbox] enqueue", error.code, error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Reivindica até `limit` eventos prontos de um tipo (skip-locked, lease de 2 min).
 * Esgotados (>= maxAttempts) ou velhos (> maxAgeSeconds) viram dead_letter e NÃO
 * voltam. Devolve [] em erro.
 */
export async function claimOutbox(
  supabase: Admin,
  input: {
    owner: string;
    kind: OutboxKind;
    limit: number;
    maxAttempts: number;
    maxAgeSeconds: number;
  }
): Promise<OutboxClaim[]> {
  const { data, error } = await supabase.rpc("outbox_claim", {
    p_owner: input.owner,
    p_kind: input.kind,
    p_limit: input.limit,
    p_max_attempts: input.maxAttempts,
    p_max_age_seconds: input.maxAgeSeconds,
  });
  if (error) {
    console.error("[outbox] claim", error.code, error.message);
    return [];
  }
  return data ?? [];
}

/**
 * Finaliza um evento. FENCING: só o dono da lease (`leaseToken`) finaliza; devolve
 * `false` se a lease expirou/mudou (outra réplica assumiu). `nextAttemptAt` só vale
 * para `retry`; sem resposta HTTP, `httpStatus` é null (a constraint recusa 0).
 */
export async function settleOutbox(
  supabase: Admin,
  input: {
    id: string;
    leaseToken: string;
    status: OutboxSettleStatus;
    nextAttemptAt?: string | null;
    httpStatus?: number | null;
    error?: string | null;
  }
): Promise<boolean> {
  const { data, error } = await supabase.rpc("outbox_settle", {
    p_id: input.id,
    p_lease_token: input.leaseToken,
    p_status: input.status,
    // Os tipos gerados marcam estes args como não-nulos, mas o SQL aceita e
    // precisa de null (sem HTTP não há status; sem retry não há próximo prazo).
    p_next_attempt_at: input.nextAttemptAt ?? null,
    p_http_status: input.httpStatus ?? null,
    p_error: input.error ?? null,
  } as unknown as Database["public"]["Functions"]["outbox_settle"]["Args"]);
  if (error) {
    console.error("[outbox] settle", error.code, error.message);
    return false;
  }
  return data === true;
}
