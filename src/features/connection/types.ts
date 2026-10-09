import type { ConnectionState } from "@/features/chat/lib/connection/uazapi";

// Tipos neutros do monitor de conexão: o servidor preenche, o aviso do topo e
// a aba Saúde (cliente) consomem.

/** Uma mudança de estado da conexão do WhatsApp. */
export type ConnectionEvent = {
  state: ConnectionState;
  reason: string | null;
  occurredAt: string;
};

/**
 * O estado segundo o monitor: o atual (a mudança mais nova) e desde quando.
 * `current: null` = o monitor ainda não rodou para esta integração.
 */
export type ConnectionStatus = { configured: false } | { configured: true; current: ConnectionEvent | null };
