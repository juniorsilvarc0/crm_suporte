import { createHmac } from "node:crypto";

/**
 * Assinatura do que o CRM envia a um endereço de fora (o relay; na Fase 6, os
 * webhooks de saída): `v1=` + HMAC-SHA256, em hex, de `<timestamp>.<corpo>`,
 * com o segredo combinado com o destino.
 *
 * O timestamp entra na conta: quem recebe recusa um pedido velho, e uma
 * captura não serve para ser reenviada depois. O corpo é o texto EXATO que sai
 * no pedido; quem confere usa os bytes recebidos, sem reserializar o JSON.
 *
 * LANÇA com segredo vazio: um HMAC de chave vazia qualquer um refaz, e
 * pareceria uma assinatura válida.
 */
export function signEvent(secret: string, timestamp: string, body: string): string {
  if (!secret) throw new Error("hmac: segredo vazio");
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `v1=${digest}`;
}
