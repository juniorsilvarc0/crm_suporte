import { isContractStatus } from "@/features/contracts/lib/contract-status";
import type { CustomerSummary } from "@/features/customers/types";

// Neutro: a rota do contato no chat, as queries e o client importam.

/** Nome que a interface mostra: a fantasia, quando existe; senão a razão social. */
export function customerDisplayName(
  customer: Pick<CustomerSummary, "legal_name" | "trade_name">
): string {
  return customer.trade_name ?? customer.legal_name;
}

/** As colunas do CustomerSummary como o banco devolve (selo ainda como texto). */
export type CustomerSummaryRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  contract_status: string | null;
  archived_at: string | null;
};

/**
 * Monta o resumo CAMPO A CAMPO, nunca com spread: coluna a mais que a consulta
 * traga (search_name, um valor de contrato) não chega à resposta. Selo que o
 * app não conhece vira `null` ("Sem contrato") em vez de um texto cru na tela.
 */
export function toCustomerSummary(row: CustomerSummaryRow): CustomerSummary {
  return {
    id: row.id,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    cnpj: row.cnpj,
    contract_status: isContractStatus(row.contract_status) ? row.contract_status : null,
    archived_at: row.archived_at,
  };
}
