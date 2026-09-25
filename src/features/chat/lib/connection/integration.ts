// Leitura/gravação da ÚNICA integração uazapi (app single-tenant). Todas as
// rotas de conexão, de envio e o webhook penduram nesta linha de
// chat_integrations.
//
// `config` guarda só o que não é segredo (`apiUrl`); o check
// `chat_integrations_config_without_secret` recusa token ali. O token da
// instância e o segredo do webhook ficam no Vault e só saem por
// `get_chat_integration_secret`, aqui. Não há fallback para env: sem segredo
// no Vault, a integração conta como não configurada (falha fechada).

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ChatIntegrationSecretKind = "token" | "webhook_secret";

export type UazapiIntegration = {
  id: string;
  apiUrl: string;
  token: string;
  phone_number: string | null;
};

type IntegrationRow = { id: string; config: Json; phone_number: string | null };

/**
 * Segredo da integração no Vault, ou null se não foi configurado.
 *
 * Erro de leitura LANÇA em vez de virar null: "o Vault não respondeu" não é
 * "não configurado", e tratar os dois igual esconderia a falha atrás de um
 * "conecte o WhatsApp" que não resolve nada.
 */
export async function getChatIntegrationSecret(
  supabase: Admin,
  integrationId: string,
  kind: ChatIntegrationSecretKind
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_chat_integration_secret", {
    p_integration_id: integrationId,
    p_kind: kind,
  });
  if (error) throw error;
  return typeof data === "string" && data.length > 0 ? data : null;
}

/** Grava (ou troca) um segredo da integração no Vault. */
export async function setChatIntegrationSecret(
  supabase: Admin,
  integrationId: string,
  kind: ChatIntegrationSecretKind,
  value: string
): Promise<void> {
  const { error } = await supabase.rpc("set_chat_integration_secret", {
    p_integration_id: integrationId,
    p_kind: kind,
    p_value: value,
  });
  if (error) throw error;
}

/**
 * Devolve o segredo que já existe; se não existe, grava `candidate`. Atômico no
 * banco (trava da linha): duas conexões simultâneas recebem o MESMO valor.
 * Use o valor devolvido, nunca o candidato — é ele que está no Vault.
 */
export async function ensureChatIntegrationSecret(
  supabase: Admin,
  integrationId: string,
  kind: ChatIntegrationSecretKind,
  candidate: string
): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_chat_integration_secret", {
    p_integration_id: integrationId,
    p_kind: kind,
    p_candidate: candidate,
  });
  if (error) throw error;
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("ensure_chat_integration_secret sem valor");
  }
  return data;
}

async function withToken(
  supabase: Admin,
  row: IntegrationRow | null
): Promise<UazapiIntegration | null> {
  if (!row) return null;
  const config =
    row.config && typeof row.config === "object" && !Array.isArray(row.config)
      ? row.config
      : {};
  const apiUrl = typeof config.apiUrl === "string" ? config.apiUrl : "";
  if (!apiUrl) return null;

  const token = await getChatIntegrationSecret(supabase, row.id, "token");
  if (!token) return null;

  return { id: row.id, apiUrl, token, phone_number: row.phone_number };
}

/** Integração uazapi ativa com credenciais completas, ou null. */
export async function getUazapiIntegration(
  supabase: Admin
): Promise<UazapiIntegration | null> {
  const { data, error } = await supabase
    .from("chat_integrations")
    .select("id, config, phone_number")
    .eq("provider", "uazapi")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  return withToken(supabase, data);
}

/**
 * Credenciais da integração de uma conversa. Conversa sem integração (a
 * integração foi excluída: FK `on delete set null`) devolve null.
 */
export async function getIntegrationCredentials(
  supabase: Admin,
  integrationId: string | null
): Promise<UazapiIntegration | null> {
  if (!integrationId) return null;

  const { data, error } = await supabase
    .from("chat_integrations")
    .select("id, config, phone_number")
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw error;

  return withToken(supabase, data);
}
