import type { SupabaseClient } from "@supabase/supabase-js";

import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { getUazapiStatus, type ConnectionState } from "@/features/chat/lib/connection/uazapi";
import type { Database } from "@/lib/supabase/types";

// Monitor de conexão do WhatsApp (worker). Em 2026-10-08 a sessão caiu às 16:06
// (Brasília) e o CRM só soube 15 horas depois: nada guardava o estado da
// instância. Este job consulta o status a cada poucos minutos e grava em
// `chat_connection_events` só quando o estado MUDA.
//
// ⚠️ Só LÊ o provedor: `GET /instance/status`, a mesma consulta do painel de
// Conexão. Não pede QR, não reconecta, não reregistra webhook e não escreve em
// `chat_integrations` (nem o telefone do dono, que é da rota /state). A sessão
// do WhatsApp nunca é tocada por aqui.

type Admin = SupabaseClient<Database>;

/** Provedor que não respondeu: não dá para afirmar que a sessão caiu. */
export const PROVIDER_UNREACHABLE = "o provedor não respondeu";

export type ConnectionCheck =
  | { status: "skipped" }
  | { status: "unchanged"; state: ConnectionState }
  | { status: "changed"; from: ConnectionState | null; state: ConnectionState };

/**
 * Uma rodada do monitor. Nunca lança: falha de leitura vira log e `skipped`
 * (melhor não gravar nada do que gravar um estado errado).
 */
export async function checkWhatsappConnection(supabase: Admin): Promise<ConnectionCheck> {
  let integration: Awaited<ReturnType<typeof getUazapiIntegration>>;
  try {
    integration = await getUazapiIntegration(supabase);
  } catch (error) {
    console.error("[whatsapp-monitor] integração", error instanceof Error ? error.message : error);
    return { status: "skipped" };
  }
  if (!integration) return { status: "skipped" };

  let state: ConnectionState;
  let reason: string | null;
  try {
    const result = await getUazapiStatus(integration.apiUrl, integration.token);
    state = result.state;
    reason = result.reason;
  } catch {
    // A mensagem do erro pode trazer o corpo da resposta do provedor: não vai
    // para o banco nem para o log.
    state = "unknown";
    reason = PROVIDER_UNREACHABLE;
  }

  const { data: last, error } = await supabase
    .from("chat_connection_events")
    .select("state")
    .eq("integration_id", integration.id)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[whatsapp-monitor] último estado", error.code, error.message);
    return { status: "skipped" };
  }

  const from = (last?.state as ConnectionState | undefined) ?? null;
  if (from === state) return { status: "unchanged", state };

  const { error: insertError } = await supabase.from("chat_connection_events").insert({
    integration_id: integration.id,
    state,
    // Conectado não tem motivo; o resto leva o que o provedor disse (ou nada).
    reason: state === "open" ? null : reason,
    source: "poll",
  });
  if (insertError) {
    console.error("[whatsapp-monitor] gravar mudança", insertError.code, insertError.message);
    return { status: "skipped" };
  }

  console.info(`[whatsapp-monitor] ${from ?? "—"} → ${state}${reason && state !== "open" ? ` (${reason})` : ""}`);
  return { status: "changed", from, state };
}
