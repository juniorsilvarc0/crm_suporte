import type { ContractStatus, ExpenseCategory, PaymentMethod, PaymentStatus } from "@/lib/supabase/types";

export type { ContractStatus, ExpenseCategory, PaymentMethod, PaymentStatus };

/**
 * Venda de um lead, já resolvida para exibição no modal do lead.
 *
 * `method` vem de `payments`, nunca de `contracts.signal_amount` — a coluna
 * escalar duplicava o valor recebido sem nada manter as duas em sincronia, e
 * por isso deixou de ser escrita.
 */
export type LeadSale = {
  id: string;
  leadId: string;
  procedureName: string | null;
  totalAmount: number;
  discount: number;
  netAmount: number;
  status: ContractStatus;
  createdAt: string;
  notes: string | null;
  method: PaymentMethod | null;
};

export type ContractWithBalance = {
  id: string;
  lead_id: string | null;
  cliente: string | null;
  tipo_ensaio: string | null;
  package_name: string | null;
  total_amount: number;
  signal_amount: number;
  discount: number;
  net_amount: number;
  valor_pago: number;
  saldo: number;
  status: ContractStatus;
  notes: string | null;
  created_at: string;
  payments: PaymentLedgerItem[];
};

export type PaymentLedgerItem = {
  id: string;
  amount: number;
  method: PaymentMethod | null;
  installments: number;
  status: PaymentStatus;
  due_at: string | null;
  paid_at: string | null;
  is_signal: boolean;
  notes: string | null;
  created_at: string;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type Payment = {
  id: string;
  lead_id: string | null;
  contract_id: string | null;
  amount: number;
  method: PaymentMethod | null;
  installments: number;
  is_signal: boolean;
  status: PaymentStatus;
  due_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  category: ExpenseCategory;
  kind: "fixa" | "variavel";
  description: string | null;
  amount: number;
  status: "pago" | "pendente";
  due_at: string | null;
  paid_at: string | null;
  recurring: boolean;
  vendor: string | null;
  notes: string | null;
  created_at: string;
};

export type FinanceOverview = {
  aReceber: number;
  recebidoMes: number;
  aPagar: number;
  saidasMes: number;
  saldoMes: number;
  recebidoTotal: number;
};
