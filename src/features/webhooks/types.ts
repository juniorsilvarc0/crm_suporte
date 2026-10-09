import type { WebhookEvent } from "@/features/webhooks/catalog";

// Tipos neutros dos webhooks de saída: as rotas preenchem, a tela (6c-3) consome.

/** Um destino, como a tela o vê. O segredo nunca sai: só se ele existe. */
export type WebhookSubscription = {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDeliveryStatus = "pending" | "processing" | "retry" | "sent" | "dead_letter" | "skipped";

/** Uma entrega (uma linha `webhook` do event_outbox). Sem a lease. */
export type WebhookDelivery = {
  id: string;
  subscriptionId: string | null;
  event: string | null;
  eventId: string | null;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string;
  httpStatus: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
};
