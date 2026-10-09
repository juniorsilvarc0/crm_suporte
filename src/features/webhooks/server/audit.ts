import type { SupabaseClient } from "@supabase/supabase-js";

import { recordIntegrationLog } from "@/features/integrations/queries/record-integration-log";
import { PING_EVENT, type WebhookAuditAction } from "@/features/webhooks/catalog";
import type { Database } from "@/lib/supabase/types";

/**
 * Registra quem fez o quê num destino. A ação já aconteceu: falha ao registrar
 * não derruba a resposta. Nada de URL, segredo ou corpo no registro — a URL
 * pode carregar token no caminho.
 */
export async function auditWebhook(
  supabase: SupabaseClient<Database>,
  action: WebhookAuditAction,
  input: {
    by: string;
    subscriptionId: string;
    detail?: Record<string, string | string[]>;
    error?: string | null;
    requestId?: string;
    httpStatus?: number;
    latencyMs?: number;
  }
): Promise<void> {
  try {
    await recordIntegrationLog(supabase, {
      provider: "webhooks",
      direction: action === PING_EVENT ? "outbound" : undefined,
      action,
      status: input.error ? "error" : "ok",
      payload: { by: input.by, subscription_id: input.subscriptionId, ...input.detail },
      error: input.error ?? undefined,
      requestId: input.requestId,
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs,
    });
  } catch (error) {
    console.error("[webhooks] registrar a ação falhou:", error);
  }
}
