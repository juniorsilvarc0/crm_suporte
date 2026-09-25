import type { MessageDeliveryStatus } from "@/features/chat/types";

// Guarda MONÓTONA do delivery_status (ticks só avançam, nunca regridem).
//
// Webhooks da uazapi não têm ordem garantida (retry/reordenação): um 'read' pode
// chegar antes do 'delivered'. E o update pós-envio ('sent') pode correr com um
// 'delivered'/'read' que chegou durante o await do envio. Sem guarda, o tick
// regride e trava abaixo do real. A solução: só sobrescrever quando o status
// atual estiver ABAIXO do novo.
//
// Ordem: pending < sent < delivered < read. 'failed' é quase-terminal: só
// sobrescreve 'pending' (um 'sent'/'delivered' tardio não deve marcar como
// falha, e um 'error' tardio não deve apagar uma entrega já confirmada).
const OVERRIDABLE: Record<MessageDeliveryStatus, MessageDeliveryStatus[]> = {
  pending: [],
  failed: ["pending"],
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
};

/** Status atuais que `next` PODE sobrescrever (para usar em `.in(...)`). */
export function overridableFrom(next: MessageDeliveryStatus): MessageDeliveryStatus[] {
  return OVERRIDABLE[next] ?? [];
}
