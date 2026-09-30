import { isContractStatus } from "@/features/contracts/lib/contract-status";
import type { ContractView } from "@/features/contracts/types";
import type { ProductOption } from "@/features/products/types";

// Leitura do contrato SEM valor, compartilhada pela ficha da empresa
// (get-customer-detail) e pela API v1 (/customers/{id}/contract). Neutro: só
// o select e o mapeamento, sem client do Supabase.

// ⚠️ Colunas SEMPRE explícitas em support_contracts: o service_role não lê
// monthly_amount, então select('*') ou um embed support_contracts(*) falham com
// 42501 para todos. O valor sai só por getContractAmounts (admin, RPC).
export const CONTRACT_SELECT =
  "id, status, starts_on, ends_on, created_at, plan:support_plans(id, name, archived_at), products:support_contract_products(product:products(id, name, niche, color, archived_at))";

export type ContractRowFromDb = {
  id: string;
  status: string;
  starts_on: string;
  ends_on: string | null;
  created_at: string;
  plan: { id: string; name: string; archived_at: string | null } | null;
  products: { product: ProductOption | null }[];
  billing_day?: number;
};

// Campo a campo, como toCustomerSummary: nada além do ContractView (e do dia de
// vencimento, quando veio) chega ao payload da página.
export function toContractView(row: ContractRowFromDb): ContractView | null {
  if (!isContractStatus(row.status)) return null;
  const products = row.products
    .flatMap(({ product }) =>
      product
        ? [
            {
              id: product.id,
              name: product.name,
              niche: product.niche,
              color: product.color,
              archived_at: product.archived_at,
            },
          ]
        : []
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    id: row.id,
    status: row.status,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    created_at: row.created_at,
    plan: row.plan
      ? { id: row.plan.id, name: row.plan.name, archived: row.plan.archived_at !== null }
      : null,
    products,
  };
}
