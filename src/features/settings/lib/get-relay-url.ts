import type { SupabaseClient } from "@supabase/supabase-js";

import { assertSafeUrl, UnsafeUrlError } from "@/lib/security/ssrf-guard";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

export type RelayConfig = {
  // URL salva na UI (app_settings.automation.relay_url), ou null se não configurada.
  configuredUrl: string | null;
  // active: há URL e o envio a aceita.
  // refused: há URL, mas a guarda do envio a recusa (`reason` diz por quê): nada
  //   é repassado.
  // none: sem URL, o CRM não repassa. Não existe reserva em variável de
  //   ambiente (N8N_WEBHOOK_URL saiu no relay v1).
  // unreadable: a leitura falhou, e não se sabe se há URL.
  state: "active" | "refused" | "none" | "unreadable";
  reason: string | null;
};

// `value` é jsonb livre: só um objeto com `relay_url` em texto não vazio conta.
function relayUrlFrom(value: Json | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = value.relay_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

// A guarda da URL do agente, a mesma ao salvar e a cada envio: HTTPS em produção
// e nada de rede interna (assertSafeUrl), e sem credencial embutida, que o fetch
// recusa e que ficaria legível na tela. LANÇA UnsafeUrlError.
export function assertRelayUrl(rawUrl: string): URL {
  const url = assertSafeUrl(rawUrl);
  if (url.username || url.password) {
    throw new UnsafeUrlError("A URL não pode levar usuário e senha.");
  }
  return url;
}

// URL para onde o CRM repassa as mensagens do bot (agente de IA, n8n, make, etc.).
// LANÇA se a leitura falhar: para o relay, "não consegui ler" não é "sem agente".
export async function readRelayUrl(supabase: SupabaseClient<Database>): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "automation")
    .maybeSingle();
  if (error) throw new Error(`app_settings: ${error.message}`);
  return relayUrlFrom(data?.value);
}

// Para a tela de Configurações (leitura resiliente): a falha vai para o log e a
// tela não cai. Mas ela diz a verdade: "não consegui ler" não aparece como "sem
// URL" (o administrador sobrescreveria uma URL que não viu), e URL que o envio
// recusa não aparece como ativa.
export async function getRelayConfig(): Promise<RelayConfig> {
  if (!hasSupabaseServerEnv()) return { configuredUrl: null, state: "none", reason: null };

  let configuredUrl: string | null;
  try {
    configuredUrl = await readRelayUrl(createSupabaseServerClient());
  } catch (error) {
    console.error("getRelayConfig failed", error);
    return { configuredUrl: null, state: "unreadable", reason: null };
  }
  if (!configuredUrl) return { configuredUrl: null, state: "none", reason: null };

  try {
    assertRelayUrl(configuredUrl);
  } catch (error) {
    const reason = error instanceof UnsafeUrlError ? error.message : "URL inválida.";
    return { configuredUrl, state: "refused", reason };
  }
  return { configuredUrl, state: "active", reason: null };
}
