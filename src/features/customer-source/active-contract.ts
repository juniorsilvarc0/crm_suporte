import type { CustomerContract } from "@/features/customer-source/types";

/**
 * Um contrato da fonte externa está ATIVO quando a vigência dele é "ativo". A
 * TCBX traz isso em `status_vigencia` (normalizado aqui como `statusVigencia`),
 * que é o campo canônico; só na ausência dele caímos no `status`. Comparação
 * sem caixa e sem espaços, porque a fonte não promete o formato.
 */
export function isActiveContract(contract: CustomerContract): boolean {
  const value = (contract.statusVigencia ?? contract.status ?? "").trim().toLowerCase();
  return value === "ativo";
}
