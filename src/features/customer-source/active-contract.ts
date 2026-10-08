/**
 * Um contrato da fonte externa está ATIVO quando a vigência dele é "ativo". A
 * TCBX traz isso em `status_vigencia` (normalizado como `statusVigencia`), que é
 * o campo canônico; só na ausência dele caímos no `status`. Comparação sem caixa
 * e sem espaços, porque a fonte não promete o formato.
 *
 * Aceita tanto o contrato vindo da API (CustomerContract) quanto o espelhado no
 * banco (StoredExternalContract): só precisa dos dois campos de situação.
 */
export function isActiveContract(contract: {
  statusVigencia: string | null;
  status: string | null;
}): boolean {
  const value = (contract.statusVigencia ?? contract.status ?? "").trim().toLowerCase();
  return value === "ativo";
}
