import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordIntegrationLog } from "@/features/integrations/queries/record-integration-log";
import { RELAY_VERSION } from "@/features/integrations/server/relay-envelope";
import { postRelayEvent } from "@/features/integrations/server/relay-message";
import { assertRelayUrl, readRelayUrl } from "@/features/settings/lib/get-relay-url";
import { readRuntimeEnvironmentVariable } from "@/features/settings/lib/get-runtime-environment";
import { RELAY_SIGNING_SECRET_NAME } from "@/features/settings/types";
import { UnsafeUrlError } from "@/lib/security/ssrf-guard";
import type { Database } from "@/lib/supabase/types";

// O teste de conexão com o agente ("Testar conexão" na tela): um evento
// `webhook.ping` pelo MESMO caminho do repasse (mesma URL, mesma guarda, mesma
// chave, mesmos cabeçalhos), sem mensagem de cliente nenhuma. O contrato do
// evento está em docs/CONTRATO-RELAY.md.

type Admin = SupabaseClient<Database>;

export const PING_EVENT = "webhook.ping";

export type PingResult =
  /** Nada saiu: não há para onde mandar, ou o CRM não conseguiu preparar o pedido. */
  | { sent: false; error: string }
  /** O pedido saiu. `delivered` = o agente respondeu 2xx. */
  | {
      sent: true;
      /**
       * Para onde foi (só o host): a URL salva pode não ser a que está no campo
       * de quem testa (outro administrador salvou outra). O caminho fica de
       * fora, porque num webhook ele costuma ser o segredo.
       */
      host: string;
      delivered: boolean;
      error: string | null;
      httpStatus: number | null;
      latencyMs: number | null;
      /** O pedido foi com `X-CRM-Signature` (há chave no cofre). */
      signed: boolean;
    };

/**
 * O corpo do ping. O tipo e o id do evento vão DENTRO do corpo, porque a
 * assinatura cobre o corpo e não os cabeçalhos: é por eles que o agente
 * distingue o teste de uma mensagem de cliente.
 */
export function pingBody(eventId: string, now: Date = new Date()): string {
  return JSON.stringify({
    event: PING_EVENT,
    event_id: eventId,
    relay_version: RELAY_VERSION,
    sent_at: now.toISOString(),
  });
}

export async function pingAgent(supabase: Admin): Promise<PingResult> {
  let rawUrl: string | null;
  try {
    rawUrl = await readRelayUrl(supabase);
  } catch (error) {
    console.error("[relay] ler a URL do agente falhou:", error);
    return { sent: false, error: "Não foi possível ler a URL do agente." };
  }
  if (!rawUrl) return { sent: false, error: "Nenhuma URL de agente configurada." };

  let target: URL;
  try {
    target = assertRelayUrl(rawUrl);
  } catch (error) {
    return {
      sent: false,
      error: `URL do agente recusada: ${error instanceof UnsafeUrlError ? error.message : "URL inválida."}`,
    };
  }

  // Cofre ilegível não é "sem chave": o teste não sai sem assinatura por engano.
  let secret: string | null;
  try {
    secret = await readRuntimeEnvironmentVariable(RELAY_SIGNING_SECRET_NAME);
  } catch (error) {
    console.error("[relay] ler a chave de assinatura falhou:", error);
    return { sent: false, error: "Cofre indisponível: não foi possível ler a chave de assinatura." };
  }

  const eventId = randomUUID();
  const outcome = await postRelayEvent(target, secret, {
    name: PING_EVENT,
    id: eventId,
    body: pingBody(eventId),
  });

  // O teste também fica no registro, como qualquer pedido que saiu ao agente.
  // O pedido já saiu: uma falha ao registrar não esconde o desfecho de quem testa.
  try {
    await recordIntegrationLog(supabase, {
      provider: "relay",
      direction: "outbound",
      action: PING_EVENT,
      status: outcome.error ? "error" : "ok",
      error: outcome.error ?? undefined,
      requestId: eventId,
      httpStatus: outcome.httpStatus,
      latencyMs: outcome.latencyMs,
    });
  } catch (error) {
    console.error("[relay] registrar o teste de conexão falhou:", error);
  }

  return {
    sent: true,
    host: target.host,
    delivered: outcome.error === null,
    error: outcome.error,
    httpStatus: outcome.httpStatus ?? null,
    latencyMs: outcome.latencyMs ?? null,
    // O mesmo critério do envio: chave vazia não assina.
    signed: Boolean(secret),
  };
}
