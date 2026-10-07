import { phoneLookupCandidates } from "@/lib/formatters/phone";

import { getCustomerContext } from "./get-customer-context";
import type { CustomerContextResult } from "./types";

/**
 * Resolve o cliente na fonte externa pelo TELEFONE, tentando as variações
 * canônicas do número (DDD + 8 últimos, com/sem o 9, com/sem 55) até uma casar
 * um cliente único. É o que contorna o `409` (telefone ambíguo) quando ele é só
 * diferença de formato: um dos formatos costuma bater exatamente um cadastro.
 *
 * - a primeira variação que dá `ok` vence;
 * - integração desligada (`not_configured`) ou fonte fora (`unavailable`): para
 *   e devolve isso — não adianta tentar as outras;
 * - nenhuma deu certo, mas alguma foi ambígua (`409`): `ambiguous`;
 * - só "não encontrado": `not_found`.
 */
export async function resolveCustomerByPhone(phone: string): Promise<CustomerContextResult> {
  const candidates = phoneLookupCandidates(phone);
  if (candidates.length === 0) return { state: "not_found" };

  let ambiguous = false;
  for (const telefone of candidates) {
    const result = await getCustomerContext({ telefone });
    if (result.state === "ok") return result;
    if (result.state === "not_configured" || result.state === "unavailable") return result;
    if (result.state === "ambiguous") ambiguous = true;
    // not_found: tenta a próxima variação.
  }
  return ambiguous ? { state: "ambiguous" } : { state: "not_found" };
}
