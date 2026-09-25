import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/types";

// Registra um evento de integração (n8n, chat, etc.) na tabela integration_logs.
// Falha ao logar não deve quebrar o fluxo do webhook — apenas registra no console.
export async function recordIntegrationLog(
  supabase: SupabaseClient<Database>,
  input: {
    provider: string;
    direction?: "inbound" | "outbound";
    action?: string;
    status?: "ok" | "error";
    payload?: Json;
    error?: string;
  }
) {
  const { error } = await supabase.from("integration_logs").insert({
    provider: input.provider,
    direction: input.direction,
    action: input.action,
    status: input.status,
    payload: input.payload,
    error: input.error,
  });

  if (error) {
    console.error("Failed to record integration log", error);
  }
}
