import type { ColorName } from "@/features/tags/schemas/colors";

// Situação do contrato de suporte (check support_contracts_status_check). O
// mesmo vocabulário é o SELO da empresa (customers.contract_status), que um
// trigger deriva do contrato. Neutro: a rota, a query e o client importam.
export const CONTRACT_STATUSES = ["ativo", "suspenso", "encerrado"] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export function isContractStatus(value: unknown): value is ContractStatus {
  return CONTRACT_STATUSES.some((status) => status === value);
}

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  ativo: "Ativo",
  suspenso: "Suspenso",
  encerrado: "Encerrado",
};

const CONTRACT_SEAL_LABEL: Record<ContractStatus, string> = {
  ativo: "Contrato ativo",
  suspenso: "Contrato suspenso",
  encerrado: "Contrato encerrado",
};

// Selo sem status = a empresa nunca teve contrato.
export function contractSealLabel(status: ContractStatus | null): string {
  return status ? CONTRACT_SEAL_LABEL[status] : "Sem contrato";
}

export const CONTRACT_STATUS_COLOR: Record<ContractStatus, ColorName> = {
  ativo: "emerald",
  suspenso: "amber",
  encerrado: "gray",
};
