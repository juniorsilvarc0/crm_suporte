import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

export type RelayConfig = {
  // URL salva na UI (app_settings.automation.relay_url), ou null se não configurada.
  configuredUrl: string | null;
  // URL efetivamente usada pelo relay: a da UI; se vazia, cai no env (fallback).
  effectiveUrl: string | null;
  // De onde veio a URL efetiva.
  source: "ui" | "env" | "none";
};

// URL para onde o CRM repassa as mensagens do bot (agente de IA, n8n, make, etc.).
// Precedência: config da UI (app_settings) → env N8N_WEBHOOK_URL (retrocompat).
export async function getRelayConfig(): Promise<RelayConfig> {
  const envUrl = process.env.N8N_WEBHOOK_URL?.trim() || null;

  let configuredUrl: string | null = null;
  if (hasSupabaseServerEnv()) {
    try {
      const supabase = createSupabaseServerClient();
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "automation")
        .maybeSingle();
      if (error) {
        console.error("getRelayConfig failed", error.message);
      } else {
        const value = (data?.value ?? {}) as { relay_url?: string };
        configuredUrl = value.relay_url?.trim() || null;
      }
    } catch (error) {
      console.error("getRelayConfig threw", error);
    }
  }

  const effectiveUrl = configuredUrl ?? envUrl;
  const source: RelayConfig["source"] = configuredUrl
    ? "ui"
    : envUrl
      ? "env"
      : "none";

  return { configuredUrl, effectiveUrl, source };
}

// Conveniência para os webhooks: só a URL efetiva (ou null).
export async function getRelayUrl(): Promise<string | null> {
  return (await getRelayConfig()).effectiveUrl;
}
