// Leitura/gravação da ÚNICA integração uazapi (app single-tenant). Todas as
// rotas de conexão e o webhook penduram nesta linha de chat_integrations.

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type UazapiIntegration = {
  id: string;
  apiUrl: string;
  token: string;
  phone_number: string | null;
};

/** Integração uazapi ativa com credenciais válidas, ou null. */
export async function getUazapiIntegration(
  supabase: Admin
): Promise<UazapiIntegration | null> {
  const { data } = await supabase
    .from("chat_integrations")
    .select("id, config, phone_number")
    .eq("provider", "uazapi")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const config = (data.config ?? {}) as Record<string, string>;
  if (!config.apiUrl || !config.token) return null;

  return {
    id: data.id,
    apiUrl: config.apiUrl,
    token: config.token,
    phone_number: data.phone_number,
  };
}
