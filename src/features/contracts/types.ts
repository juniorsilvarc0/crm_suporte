import type { ContractStatus } from "@/features/contracts/lib/contract-status";
import type { ProductOption } from "@/features/products/types";

// ⚠️ Escritos à mão, NUNCA derivados do Row de support_contracts: o Row traz
// monthly_amount, e um tipo que carrega o valor acaba serializado para o
// member ou para uma listagem. O valor só existe em AdminContractView.

// Contrato como todos veem: sem valor e sem dia de vencimento.
export type ContractView = {
  id: string;
  status: ContractStatus;
  starts_on: string;
  ends_on: string | null;
  created_at: string;
  plan: { id: string; name: string; archived: boolean } | null;
  products: ProductOption[];
};

// Só para admin. `monthly_amount: null` = "Valor indisponível" (a RPC falhou
// ou não devolveu o contrato) — a tela nunca mostra R$ 0 no lugar.
export type AdminContractView = ContractView & {
  billing_day: number;
  monthly_amount: number | null;
};

export type SupportPlanOption = {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
};
