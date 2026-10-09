// Catálogo dos eventos de saída que um destino pode assinar (Fase 6c). Os
// nomes são os de `ticket_events.event_type` e do plano (§C); o banco só
// confere o formato, quem diz o que existe é esta lista. O `webhook.ping` não
// se assina: é o teste de conexão, enviado na hora a um destino.

export const WEBHOOK_EVENTS = [
  "ticket.created",
  "ticket.updated",
  "ticket.priority_changed",
  "ticket.assigned",
  "ticket.status_changed",
  "ticket.reopened",
  "ticket.comment_added",
  "ticket.attachment_added",
  "ticket.sla_breached",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const PING_EVENT = "webhook.ping";

/**
 * A trilha do que um administrador fez nos destinos, em `integration_logs`
 * (integração `webhooks`). A aba Registros monta o filtro daqui. As entregas em
 * si não entram: o histórico delas é a própria fila (`event_outbox`).
 */
export const WEBHOOK_AUDIT_ACTIONS = [
  "subscription.created",
  "subscription.updated",
  "subscription.deleted",
  "secret.rotated",
  PING_EVENT,
  "delivery.requeued",
] as const;

export type WebhookAuditAction = (typeof WEBHOOK_AUDIT_ACTIONS)[number];

export const webhookEventLabel: Record<WebhookEvent, string> = {
  "ticket.created": "Ticket aberto",
  "ticket.updated": "Ticket alterado",
  "ticket.priority_changed": "Prioridade alterada",
  "ticket.assigned": "Responsável alterado",
  "ticket.status_changed": "Status alterado",
  "ticket.reopened": "Ticket reaberto",
  "ticket.comment_added": "Nota interna adicionada (sem o texto)",
  "ticket.attachment_added": "Anexo adicionado",
  "ticket.sla_breached": "SLA estourado",
};

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
