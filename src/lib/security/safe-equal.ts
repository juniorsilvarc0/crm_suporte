import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante.
 *
 * `===` para no primeiro caractere diferente, e o tempo de resposta vaza
 * quanto do segredo o atacante já acertou. O hash antes do `timingSafeEqual`
 * iguala os tamanhos (ele lança com buffers de tamanhos diferentes) sem
 * vazar o tamanho do segredo.
 */
export function safeEqual(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
