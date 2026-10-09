import { signEvent } from "@/lib/security/hmac";

// O POST de um evento a um destino de webhook. Mesmo contrato do relay
// (docs/PLANO-IMPLANTACAO.md §C): cabeçalhos do evento, assinatura
// `v1=HMAC-SHA256(segredo, "<timestamp>.<corpo>")`, prazo de 10 s e SEM seguir
// redirecionamento (seguir levaria o corpo e a assinatura a um endereço que
// ninguém configurou). 2º envio assinado do projeto (o 1º é postRelayEvent):
// duplicado de propósito, com as mensagens do webhook (AGENTS §0.2.2).

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_USER_AGENT = "crm-suporte-webhooks/1";

export type WebhookSendOutcome = {
  /** null = o destino respondeu 2xx. */
  error: string | null;
  httpStatus?: number;
  latencyMs: number;
};

function sendFailure(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error ? error.name : null;
  if (name === "TimeoutError") return `O destino não respondeu em ${WEBHOOK_TIMEOUT_MS / 1000} s.`;
  const cause = error instanceof Error ? error.cause : null;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  return typeof code === "string" ? `Falha de rede (${code}).` : "Falha de rede.";
}

/** Nunca rejeita: a falha vem no desfecho. O corpo da resposta é descartado. */
export async function postWebhook(
  target: URL,
  secret: string,
  event: { name: string; id: string; body: string }
): Promise<WebhookSendOutcome> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": WEBHOOK_USER_AGENT,
        "X-CRM-Event": event.name,
        "X-CRM-Event-Id": event.id,
        "X-CRM-Timestamp": timestamp,
        "X-CRM-Signature": signEvent(secret, timestamp, event.body),
      },
      body: event.body,
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const latencyMs = elapsed();
    await response.body?.cancel().catch(() => undefined);
    const { status } = response;
    return {
      error: response.ok ? null : `O destino respondeu HTTP ${status}.`,
      // Fora da faixa do check do banco, o status já está no motivo.
      httpStatus: status >= 100 && status <= 599 ? status : undefined,
      latencyMs,
    };
  } catch (error) {
    return { error: sendFailure(error), latencyMs: elapsed() };
  }
}
