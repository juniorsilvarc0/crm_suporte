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
  /** Tem ao menos um contrato ATIVO na fonte externa (TCBX). Espelho read-only
   *  — não é o selo interno (contract_status), que vem do support_contracts. */
  has_external_active: boolean;
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

/**
 * Contrato do cliente na fonte externa (TCBX), ESPELHADO no banco
 * (`external_contracts`) e lido pela ficha. Somente leitura: a TCBX é a fonte da
 * verdade; o CRM nunca cria nem edita. Neutro: a tela (client) o usa sem puxar o
 * módulo de servidor.
 */
export type StoredExternalContract = {
  id: string;
  externalId: string;
  numero: string | null;
  modalidade: string | null;
  status: string | null;
  statusVigencia: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  vencimentoDia: number | null;
  dataAtivacao: string | null;
  syncedAt: string;
};

/**
 * Resultado de uma leva da reconciliação de contratos a partir da fonte externa
 * (src/features/customers/server/external-contracts.ts). Tipo neutro: a tela
 * (client) o usa sem puxar o módulo de servidor.
 */
export type ReconcileContractsReport = {
  processed: number;
  /** Empresas sincronizadas com sucesso (a fonte respondeu). */
  ok: number;
  /** Empresa que a fonte não achou: o espelho dela foi esvaziado. */
  notFound: number;
  /** A fonte não respondeu para a empresa (transitório): espelho preservado. */
  unavailable: number;
  /** A fonte achou mais de um cadastro para o CNPJ (409). */
  ambiguous: number;
  /** Empresa sem CNPJ: não há chave de consulta. */
  skipped: number;
  /** Contratos gravados/atualizados no espelho nesta leva. */
  contractsUpserted: number;
  /** Última empresa processada — vai como `after` na próxima leva. */
  cursor: string | null;
  /** Não há mais empresas a processar. */
  done: boolean;
  /** A fonte está desligada (not_configured): a leva abortou. */
  notConfigured: boolean;
};

// Contato ligado à empresa, como a ficha lista.
export type CustomerContact = {
  id: string;
  name: string | null;
  phone: string;
  last_message_at: string | null;
};

/**
 * Resultado de uma leva do cadastro em massa a partir da fonte externa
 * (src/features/customers/server/backfill-external.ts). Tipo neutro: a tela
 * (client) o usa sem puxar o módulo de servidor.
 */
export type BackfillReport = {
  processed: number;
  created: number;
  reused: number;
  linked: number;
  notFound: number;
  /** Telefone que casou MAIS DE UM cliente na fonte (409): pulado. */
  ambiguous: number;
  skippedPf: number;
  errors: number;
  /** Último contato processado — vai como `after` na próxima leva. */
  cursor: string | null;
  /** Não há mais contatos a processar. */
  done: boolean;
};
