import { setTimeout as delay } from "node:timers/promises";

import type { SupabaseClient } from "@supabase/supabase-js";

import { UnsafeUrlError } from "@/features/chat/lib/connection/ssrf-guard";
import { recordIntegrationLog } from "@/features/integrations/queries/record-integration-log";
import {
  buildRelayFields,
  relayEnvelope,
  RELAY_VERSION,
  type RelayMessage,
} from "@/features/integrations/server/relay-envelope";
import { assertRelayUrl, readRelayUrl } from "@/features/settings/lib/get-relay-url";
import { readRuntimeEnvironmentVariable } from "@/features/settings/lib/get-runtime-environment";
import { RELAY_SIGNING_SECRET_NAME } from "@/features/settings/types";
import { signEvent } from "@/lib/security/hmac";
import type { Database } from "@/lib/supabase/types";

// O repasse de uma mensagem do cliente ao agente (relay v1, PR 11 do
// docs/PLANO-FASE-5.md). O que sai e como conferir está em docs/CONTRATO-RELAY.md.

type Admin = SupabaseClient<Database>;

/** Teto do repasse: sem ele, um agente que não responde deixa o fetch pendurado. */
export const RELAY_TIMEOUT_MS = 10_000;
/** Espera antes da 2ª tentativa, quando só uma leitura falhou e nada saiu. */
export const RELAY_RETRY_DELAY_MS = 1_000;
/** O evento do cabeçalho X-CRM-Event (catálogo do docs/PLANO-IMPLANTACAO.md §C). */
export const RELAY_EVENT = "conversation.message_received";
export const RELAY_USER_AGENT = `crm-suporte-relay/${RELAY_VERSION}`;

/** Abaixo disso, procurar a credencial no corpo acharia texto comum. */
const MIN_SCANNABLE_SECRET = 16;

export type RelayDelivery = RelayMessage & {
  /** O token da instância uazapi: o repasse confere que ele NÃO está no corpo. */
  instanceToken: string;
};

/** O desfecho de uma tentativa: é o que vai para integration_logs. */
type Outcome = {
  error: string | null;
  httpStatus?: number;
  latencyMs?: number;
  /** Só uma leitura falhou, e nada saiu: vale tentar de novo. */
  retry?: true;
};

function sendFailure(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error ? error.name : null;
  if (name === "TimeoutError") return `O agente não respondeu em ${RELAY_TIMEOUT_MS / 1000} s.`;
  const cause = error instanceof Error ? error.cause : null;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  return typeof code === "string" ? `Falha de rede (${code}).` : "Falha de rede.";
}

/** `null` = sem agente configurado: não há o que repassar nem o que registrar. */
async function attempt(supabase: Admin, message: RelayDelivery): Promise<Outcome | null> {
  // 1) Para onde. Leitura que falha não é "sem agente": fica registrada.
  let rawUrl: string | null;
  try {
    rawUrl = await readRelayUrl(supabase);
  } catch (error) {
    console.error("[relay] ler a URL do agente falhou:", error);
    return { error: "Não foi possível ler a URL do agente.", retry: true };
  }
  if (!rawUrl) return null;

  let target: URL;
  try {
    target = assertRelayUrl(rawUrl);
  } catch (error) {
    return { error: `URL do agente recusada: ${error instanceof UnsafeUrlError ? error.message : "URL inválida."}` };
  }

  // 2) O que vai, e a chave. Tudo ou nada: sem o contexto, ou sem saber se há
  //    chave (cofre ilegível não é "sem chave"), o repasse não sai. A chave é
  //    lida sem cache: trocá-la vale já, em todas as réplicas. Com as duas
  //    leituras falhando, o motivo registrado é sempre o do envelope.
  const [fields, signingSecret] = await Promise.allSettled([
    buildRelayFields(supabase, message),
    readRuntimeEnvironmentVariable(RELAY_SIGNING_SECRET_NAME),
  ]);
  if (fields.status === "rejected") {
    console.error("[relay] montar o envelope falhou:", fields.reason);
    return { error: "Não foi possível montar o envelope.", retry: true };
  }
  if (signingSecret.status === "rejected") {
    console.error("[relay] ler a chave de assinatura falhou:", signingSecret.reason);
    return { error: "Cofre indisponível: não foi possível ler a chave de assinatura.", retry: true };
  }
  const body = JSON.stringify(relayEnvelope(message.payload, fields.value));
  const secret = signingSecret.value;

  // A credencial da instância não sai do CRM, venha onde vier no payload do
  // provedor. A da raiz já saiu em relayEnvelope; aqui é a rede de segurança.
  const { instanceToken } = message;
  if (instanceToken.length >= MIN_SCANNABLE_SECRET && body.includes(JSON.stringify(instanceToken).slice(1, -1))) {
    return { error: "O envelope trazia a credencial da instância: nada foi enviado." };
  }

  // 3) O envio. Sem chave no cofre, sai sem assinatura (um agente que a exige
  //    recusa). Redirecionamento não é seguido: levaria o envelope e a
  //    assinatura a um endereço que ninguém configurou.
  const timestamp = String(Math.floor(Date.now() / 1000));
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": RELAY_USER_AGENT,
        "X-CRM-Event": RELAY_EVENT,
        "X-CRM-Event-Id": message.messageId,
        "X-CRM-Timestamp": timestamp,
        ...(secret ? { "X-CRM-Signature": signEvent(secret, timestamp, body) } : {}),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    const latencyMs = elapsed();
    // Só o status interessa: o corpo é descartado, e a conexão liberada.
    await response.body?.cancel().catch(() => undefined);
    const { status } = response;
    return {
      error: response.ok ? null : `O agente respondeu HTTP ${status}.`,
      // Fora da faixa do check do banco (um agente pode responder 999), o
      // registro seria recusado e a falha sumiria: o número já está no motivo.
      httpStatus: status >= 100 && status <= 599 ? status : undefined,
      latencyMs,
    };
  } catch (error) {
    return { error: sendFailure(error), latencyMs: elapsed() };
  }
}

/**
 * Repassa ao agente uma mensagem recém-gravada do cliente.
 *
 * Quem chama NÃO espera a resposta do agente (o webhook responde à uazapi
 * antes): por isso esta função nunca rejeita, e o desfecho vai para
 * `integration_logs` (provider `relay`), com status e latência.
 *
 * ⚠️ É "no máximo uma vez": o que chegou a sair nunca é enviado de novo. Só há
 * 2ª tentativa quando uma LEITURA falhou antes do envio. Quem traz a
 * retentativa de verdade é o outbox da Fase 6; o `message_id` do corpo já é
 * estável para o agente descartar repetição.
 */
export async function relayInboundMessage(supabase: Admin, message: RelayDelivery): Promise<void> {
  try {
    let outcome = await attempt(supabase, message);
    if (outcome?.retry) {
      await delay(RELAY_RETRY_DELAY_MS);
      outcome = await attempt(supabase, message);
    }
    if (!outcome) return;
    if (outcome.error) {
      // "Sem confirmação", não "não entregue": num 500, num corte de conexão ou
      // num estouro de prazo o agente pode ter recebido.
      console.warn("[relay] sem confirmação de entrega:", { eventId: message.messageId, error: outcome.error });
    }
    await recordIntegrationLog(supabase, {
      provider: "relay",
      direction: "outbound",
      action: RELAY_EVENT,
      status: outcome.error ? "error" : "ok",
      error: outcome.error ?? undefined,
      requestId: message.messageId,
      httpStatus: outcome.httpStatus,
      latencyMs: outcome.latencyMs,
    });
  } catch (error) {
    console.error("[relay] falha inesperada:", error);
  }
}
