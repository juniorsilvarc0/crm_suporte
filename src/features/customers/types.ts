import type { ContractStatus } from "@/features/contracts/lib/contract-status";

// Escritos à mão com as colunas que as telas leem, NUNCA derivados do Row de
// customers: o Row traz search_name e created_by_user_id, que não saem do
// servidor. Neutro: a rota, a query e o client importam.

// O que o chat, o seletor de empresa e as listas mostram. `contract_status` é o
// SELO que o trigger deriva do contrato; `null` = a empresa nunca teve contrato
// (ou o banco devolveu um valor que o app não conhece).
export type CustomerSummary = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  contract_status: ContractStatus | null;
  archived_at: string | null;
};

export type CustomerListItem = CustomerSummary & {
  created_at: string;
};

// `failed` = a leitura deu erro: a tela diz "não foi possível carregar", nunca
// "nenhuma empresa cadastrada".
export type CustomersPage = {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  failed: boolean;
};

// Filtro "Situação" da lista (?situacao=). "todas" é o padrão e fica fora da
// URL; valor fora da lista vira "todas" (parseCustomerListParams).
export const CUSTOMER_SITUATIONS = [
  "todas",
  "ativo",
  "suspenso",
  "encerrado",
  "sem",
  "arquivadas",
] as const;

export type CustomerSituation = (typeof CUSTOMER_SITUATIONS)[number];

export type CustomerListParams = {
  q: string;
  situacao: CustomerSituation;
  page: number;
};

// Ficha da empresa (arquivada inclusive).
export type CustomerRecord = CustomerSummary & {
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Contato ligado à empresa, como a ficha lista.
export type CustomerContact = {
  id: string;
  name: string | null;
  phone: string;
  last_message_at: string | null;
};
