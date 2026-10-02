import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/types";

// Idempotency-Key da API v1 (decisão D6; RPCs em 20260929170000). O contrato:
//   begin → started (com attempt_id) | replay | reused | in_progress
//   só a tentativa dona conclui (finish: 2xx ou 422) ou libera (release).

/** Mesmo formato de tickets.idempotency_key e de api_idempotency_keys. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotent-Replayed";
/** Lease da tentativa (D6): acima de qualquer requisição da v1. */
export const IDEMPOTENCY_LEASE_SECONDS = 300;

/** JSON com as chaves em ordem: o mesmo pedido reserializado tem o mesmo hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    // 1e400 vira Infinity no JSON.parse e "null" no stringify: colidiria com
    // null. Quem chama trata a exceção como JSON inválido (400).
    throw new RangeError("número fora do intervalo representável");
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * sha256 de um arquivo, lido em pedaços: sem copiar os 50 MB de um anexo para
 * hashear, e devolvendo o event loop entre um pedaço e outro.
 */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  const hash = createHash("sha256");
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return hash.digest("hex");
}

export type BeginOutcome =
  | { outcome: "started"; attemptId: string }
  | { outcome: "replay"; status: number; body: Json }
  | { outcome: "reused" }
  | { outcome: "in_progress" };

type Admin = SupabaseClient<Database>;

export async function beginIdempotency(
  supabase: Admin,
  input: { tokenId: string; key: string; method: string; path: string; requestHash: string }
): Promise<BeginOutcome> {
  const { data, error } = await supabase.rpc("api_idempotency_begin", {
    p_token_id: input.tokenId,
    p_key: input.key,
    p_method: input.method,
    p_route: input.path,
    p_request_hash: input.requestHash,
    p_lease_seconds: IDEMPOTENCY_LEASE_SECONDS,
  });
  if (error) throw new Error(`api_idempotency_begin: ${error.message}`);

  const result = (data ?? {}) as { outcome?: string; attempt_id?: string; status?: number; body?: Json };
  switch (result.outcome) {
    case "started":
      if (!result.attempt_id) throw new Error("api_idempotency_begin: started sem attempt_id");
      return { outcome: "started", attemptId: result.attempt_id };
    case "replay":
      return { outcome: "replay", status: Number(result.status), body: result.body ?? null };
    case "reused":
      return { outcome: "reused" };
    case "in_progress":
      return { outcome: "in_progress" };
    default:
      throw new Error(`api_idempotency_begin: outcome desconhecido (${String(result.outcome)})`);
  }
}

/**
 * Guarda a resposta da tentativa. `false` quando a tentativa perdeu a lease
 * (P0002): a resposta vai ao cliente mesmo assim, só não fica guardada.
 */
export async function finishIdempotency(
  supabase: Admin,
  input: { tokenId: string; key: string; attemptId: string; status: number; body: Json }
): Promise<boolean> {
  const { error } = await supabase.rpc("api_idempotency_finish", {
    p_token_id: input.tokenId,
    p_key: input.key,
    p_attempt_id: input.attemptId,
    p_status: input.status,
    p_body: input.body,
  });
  if (!error) return true;
  if (error.code === "P0002") return false;
  throw new Error(`api_idempotency_finish: ${error.message}`);
}

export async function releaseIdempotency(
  supabase: Admin,
  input: { tokenId: string; key: string; attemptId: string }
): Promise<void> {
  const { error } = await supabase.rpc("api_idempotency_release", {
    p_token_id: input.tokenId,
    p_key: input.key,
    p_attempt_id: input.attemptId,
  });
  if (error) throw new Error(`api_idempotency_release: ${error.message}`);
}
