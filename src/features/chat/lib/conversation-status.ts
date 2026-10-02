import type { ConversationStatus } from "@/features/chat/types";

// O dono do atendimento (check chat_conversations_status_check): bot = a IA
// conduz; human = um analista assumiu; resolved = encerrada. O `satisfies`
// amarra a lista ao tipo. Neutro: a API v1 e o mapa de erros importam.
export const CONVERSATION_STATUSES = ["bot", "human", "resolved"] as const satisfies readonly ConversationStatus[];

// `unknown` porque o valor vem do banco (coluna text, HINT de uma RPC) ou de
// uma entrada ainda não validada.
export function isConversationStatus(value: unknown): value is ConversationStatus {
  return typeof value === "string" && CONVERSATION_STATUSES.some((status) => status === value);
}
