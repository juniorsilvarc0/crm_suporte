import { setTimeout as delay } from "node:timers/promises";

import type { SupabaseClient } from "@supabase/supabase-js";

import { UnsafeUrlError } from "@/lib/security/ssrf-guard";
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

/**
 * A credencial da instância NÃO pode sair do CRM, venha onde vier no payload do
 * provedor — nem numa chave de raiz com outro nome, nem aninhada, nem no meio de
 * um texto. Abaixo de MIN_SCANNABLE_SECRET um token é curto demais para procurar
 * sem casar palavra comum. Usado ao ENFILEIRAR, fail-closed: um envelope que a
 * traz não é gravado no outbox nem entregue. A fatia `slice(1, -1)` tira as aspas
 * que o `JSON.stringify` põe, para achar o token já com o escape do JSON.
 */
export function envelopeLeaksToken(body: string, token: string): boolean {
  return token.length >= MIN_SCANNABLE_SECRET && body.includes(JSON.stringify(token).slice(1, -1));
}

export type RelayDelivery = RelayMessage & {
  /** O token da instância uazapi: o repasse confere que ele NÃO está no corpo. */
  instanceToken: string;
};

/** O desfecho de um envio ao agente: é o que vai para integration_logs. */
export type RelayOutcome = {
  error: string | null;
  httpStatus?: number;
  latencyMs?: number;
};

type Outcome = RelayOutcome & {
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

/**
 * Um POST ao agente, do jeito do contrato: os cabeçalhos do evento, a assinatura
 * quando há chave, prazo de 10 s e sem seguir redirecionamento (seguir levaria o
 * corpo e a assinatura a um endereço que ninguém configurou). É o envio do
 * repasse e do teste de conexão. Nunca rejeita: a falha vem no desfecho.
 */
export async function postRelayEvent(
  target: URL,
  secret: string | null,
  event: { name: string; id: string; body: string }
): Promise<RelayOutcome> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": RELAY_USER_AGENT,
        "X-CRM-Event": event.name,
        "X-CRM-Event-Id": event.id,
        "X-CRM-Timestamp": timestamp,
        ...(secret ? { "X-CRM-Signature": signEvent(secret, timestamp, event.body) } : {}),
      },
      body: event.body,
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

/** `null` = sem agente configurado: não há o que repassar nem o que registrar. */
async function attempt(supabase: Admin, message: RelayMessage): Promise<Outcome | null> {
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

  // 3) O envio. Sem chave no cofre, sai sem assinatura (um agente que a exige
  //    recusa). A credencial da instância já ficou de fora ao ENFILEIRAR
  //    (enqueueRelay + envelopeLeaksToken, fail-closed): o payload guardado no
  //    outbox é limpo, então aqui não há token a vazar.
  return postRelayEvent(target, secret, { name: RELAY_EVENT, id: message.messageId, body });
}

/**
 * Repassa ao agente uma mensagem recém-gravada do cliente.
 *
 * Quem chama NÃO espera a resposta do agente (o webhook responde à uazapi
 * antes): por isso esta função nunca rejeita, e o desfecho vai para
 * `integration_logs` (provider `relay`), com status e latência.
 *
 * Uma só tentativa de envio aqui (com uma 2ª só quando uma LEITURA falhou antes
 * do envio). A retentativa DURÁVEL é do outbox (Fase 6b): esta função é a
 * entrega de UM evento, e devolve o desfecho para o dispatch decidir o settle
 * (sent/retry). `null` = sem agente, ou falha inesperada já registrada no
 * console. Nunca rejeita. O `message_id` do corpo é estável para o agente
 * descartar repetição.
 */
export async function relayInboundMessage(
  supabase: Admin,
  message: RelayMessage
): Promise<RelayOutcome | null> {
  try {
    let outcome = await attempt(supabase, message);
    if (outcome?.retry) {
      await delay(RELAY_RETRY_DELAY_MS);
      outcome = await attempt(supabase, message);
    }
    if (!outcome) return null;
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
    return { error: outcome.error, httpStatus: outcome.httpStatus, latencyMs: outcome.latencyMs };
  } catch (error) {
    console.error("[relay] falha inesperada:", error);
    return null;
  }
}
