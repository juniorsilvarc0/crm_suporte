import { WEBHOOK_EVENTS, webhookEventLabel, type WebhookEvent } from "@/features/webhooks/catalog";
import type { WebhookDeliveryStatus } from "@/features/webhooks/types";

// Como a aba Webhooks escreve o que o servidor devolve. Neutro: o componente
// (client) e os testes importam daqui.

/** O host da URL salva: é para ele que o teste e as entregas vão. */
export function webhookHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "Todos os eventos", o nome do único, ou "N eventos". */
export function webhookEventsSummary(events: readonly WebhookEvent[]): string {
  if (events.length === WEBHOOK_EVENTS.length) return "Todos os eventos";
  if (events.length === 1) return webhookEventLabel[events[0]];
  return `${events.length} eventos`;
}

export type WebhookPingResult = { error: string | null; httpStatus?: number; latencyMs: number };

/**
 * O desfecho do teste em uma frase, dizendo PARA ONDE foi (o host da URL
 * salva) e o que voltou. Um 401/403 quase sempre é segredo desatualizado no
 * destino; um 3xx, endereço que redireciona (o CRM não segue).
 */
export function describeWebhookPing(host: string, result: WebhookPingResult): { delivered: boolean; message: string } {
  if (result.httpStatus === undefined) {
    return { delivered: false, message: `${host}: ${result.error ?? "sem resposta."}` };
  }
  const status = result.httpStatus;
  if (!result.error) {
    return { delivered: true, message: `${host} respondeu HTTP ${status} em ${result.latencyMs} ms.` };
  }
  if (status >= 300 && status < 400) {
    return {
      delivered: false,
      message: `${host} respondeu HTTP ${status}. O CRM não segue redirecionamento: salve o endereço final.`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      delivered: false,
      message: `${host} respondeu HTTP ${status}. Confira se o destino usa o segredo atual.`,
    };
  }
  return { delivered: false, message: `${host} respondeu HTTP ${status}.` };
}

export const WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "processing",
  "retry",
  "sent",
  "dead_letter",
  "skipped",
] as const satisfies readonly WebhookDeliveryStatus[];

export const webhookDeliveryStatusLabel: Record<WebhookDeliveryStatus, string> = {
  pending: "Na fila",
  processing: "Enviando",
  retry: "Nova tentativa",
  sent: "Entregue",
  dead_letter: "Esgotada",
  skipped: "Descartada",
};

/** Cor do texto do status (sempre acompanhado do rótulo, §1.4). */
export const webhookDeliveryStatusTone: Record<WebhookDeliveryStatus, string> = {
  pending: "text-muted-foreground",
  processing: "text-muted-foreground",
  retry: "text-amber-600 dark:text-amber-400",
  sent: "text-emerald-600 dark:text-emerald-400",
  dead_letter: "text-destructive",
  skipped: "text-muted-foreground",
};
