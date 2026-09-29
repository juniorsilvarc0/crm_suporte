import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/types";

// Registra um evento de integração (API v1, webhooks, relay) na tabela
// integration_logs. Falha ao logar não deve quebrar o fluxo — apenas registra
// no console.
//
// A API v1 (withApi) grava as colunas da chamada — token, request_id, rota
// (o TEMPLATE, nunca a URL com ids ou query) e status — e NUNCA o corpo da
// requisição: `payload` fica para eventos internos sem dado de cliente.
export async function recordIntegrationLog(
  supabase: SupabaseClient<Database>,
  input: {
    provider: string;
    direction?: "inbound" | "outbound";
    action?: string;
    status?: "ok" | "error";
    payload?: Json;
    error?: string;
    apiTokenId?: string | null;
    requestId?: string;
    route?: string;
    httpStatus?: number;
    latencyMs?: number;
  }
) {
  const { error } = await supabase.from("integration_logs").insert({
    provider: input.provider,
    direction: input.direction,
    action: input.action,
    status: input.status,
    payload: input.payload,
    error: input.error,
    api_token_id: input.apiTokenId ?? null,
    request_id: input.requestId,
    route: input.route,
    http_status: input.httpStatus,
    latency_ms: input.latencyMs,
  });

  if (error) {
    console.error("Failed to record integration log", error);
  }
}
