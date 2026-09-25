import type { FinanceOverview } from "@/features/financeiro/types";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

const PAGE_SIZE = 1000;

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;
type OverviewContract = {
  id: string;
  total_amount: number;
  discount: number | null;
  status: string;
};
type OverviewPayment = {
  contract_id: string | null;
  amount: number;
  status: string;
  paid_at: string | null;
};
type OverviewExpense = {
  amount: number;
  status: string;
  paid_at: string | null;
};

const EMPTY: FinanceOverview = {
  aReceber: 0,
  recebidoMes: 0,
  aPagar: 0,
  saidasMes: 0,
  saldoMes: 0,
  recebidoTotal: 0,
};

async function fetchContracts(supabase: SupabaseServerClient): Promise<OverviewContract[]> {
  const rows: OverviewContract[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("contracts")
      .select("id, total_amount, discount, status")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as OverviewContract[]));
    if ((data ?? []).length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchPayments(supabase: SupabaseServerClient): Promise<OverviewPayment[]> {
  const rows: OverviewPayment[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("payments")
      .select("contract_id, amount, status, paid_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as OverviewPayment[]));
    if ((data ?? []).length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchExpenses(supabase: SupabaseServerClient): Promise<OverviewExpense[]> {
  const rows: OverviewExpense[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("expenses")
      .select("amount, status, paid_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as OverviewExpense[]));
    if ((data ?? []).length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function getFinanceOverview(): Promise<FinanceOverview> {
  if (!hasSupabaseServerEnv()) return EMPTY;

  try {
    const supabase = createSupabaseServerClient();

    const [contracts, payments, expenses] = await Promise.all([
      fetchContracts(supabase),
      fetchPayments(supabase),
      fetchExpenses(supabase),
    ]);

    const now = new Date();
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Total pago por contrato (só pagamentos com status=pago)
    const paidByContract = new Map<string, number>();
    for (const p of payments) {
      if (p.status !== "pago" || !p.contract_id) continue;
      paidByContract.set(p.contract_id, (paidByContract.get(p.contract_id) ?? 0) + Number(p.amount));
    }

    // Saldo a receber = soma dos saldos de contratos em aberto
    const aReceber = contracts
      .filter((c) => c.status === "aberto")
      .reduce((s, c) => {
        const pago = paidByContract.get(c.id) ?? 0;
        const netAmount = Math.max(0, Number(c.total_amount) - Number(c.discount ?? 0));
        return s + Math.max(0, netAmount - pago);
      }, 0);

    const recebidoTotal = payments
      .filter((p) => p.status === "pago")
      .reduce((s, p) => s + Number(p.amount), 0);

    const recebidoMes = payments
      .filter((p) => p.status === "pago" && p.paid_at?.startsWith(mesAtual))
      .reduce((s, p) => s + Number(p.amount), 0);

    const aPagar = expenses
      .filter((e) => e.status === "pendente")
      .reduce((s, e) => s + Number(e.amount), 0);

    const saidasMes = expenses
      .filter((e) => e.status === "pago" && e.paid_at?.startsWith(mesAtual))
      .reduce((s, e) => s + Number(e.amount), 0);

    return {
      aReceber,
      recebidoMes,
      aPagar,
      saidasMes,
      saldoMes: recebidoMes - saidasMes,
      recebidoTotal,
    };
  } catch (err) {
    console.error("getFinanceOverview", err);
    return EMPTY;
  }
}
