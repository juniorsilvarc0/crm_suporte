import type { ChatMessage } from "@/features/chat/types";

// Quem enviou, quando não foi uma pessoa: a IA e as integrações escrevem pela
// API v1, com um token. O banco amarra o `sender_type` ao tipo do token
// (trigger de autoria da mensagem): token de IA grava `ai`, token de integração
// grava `system`.

type Sender = Pick<ChatMessage, "sender_type" | "sent_by_token_id">;

/** A mensagem (ou nota) é de um token, ou de uma automação: não de uma pessoa. */
export function isAutomatedMessage(message: Sender): boolean {
  return message.sender_type === "ai" || message.sender_type === "system" || Boolean(message.sent_by_token_id);
}

/**
 * O rótulo de quem enviou quando não foi uma pessoa. `null` para o resto:
 * cliente, analista e celular da empresa já se explicam pelo lado da bolha e
 * pela assinatura.
 *
 * Os nomes são os da trilha do ticket (`trailActorLabel`): a IA, a integração
 * (token) e o próprio sistema ("Automático", sem token).
 */
export function automatedSenderLabel(message: Sender): "IA" | "Integração" | "Automático" | null {
  if (message.sender_type === "ai") return "IA";
  if (message.sender_type === "system") return message.sent_by_token_id ? "Integração" : "Automático";
  return null;
}

const REPLY_TARGET = { IA: "a IA", Integração: "a integração", Automático: "a mensagem automática" } as const;

/** "Respondendo …": a quem a mensagem citada pertence, na barra do compositor. */
export function replyTargetLabel(message: Sender & Pick<ChatMessage, "direction">): string {
  const automated = automatedSenderLabel(message);
  if (automated) return REPLY_TARGET[automated];
  return message.direction === "outbound" ? "você mesmo" : "o contato";
}

/**
 * A bolha abre um grupo novo (ganha a ponta e o respiro maior)? Lado igual não
 * basta para colar duas bolhas: a da IA e a do analista saem do mesmo lado, e
 * coladas pareceriam do mesmo remetente. Nota nunca cola em nada.
 */
export function startsBubbleGroup(
  previous: (Sender & Pick<ChatMessage, "direction" | "type">) | undefined,
  current: Sender & Pick<ChatMessage, "direction" | "type">
): boolean {
  if (!previous) return true;
  if (previous.direction !== current.direction) return true;
  if (previous.type === "note" || current.type === "note") return true;
  return automatedSenderLabel(previous) !== automatedSenderLabel(current);
}
