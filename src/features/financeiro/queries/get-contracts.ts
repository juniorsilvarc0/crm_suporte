import type {
  ContractWithBalance,
  PaginatedResult,
  PaymentLedgerItem,
} from "@/features/financeiro/types";
import type { ContractStatus } from "@/lib/supabase/types";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

// O Supabase não infere o tipo do join payments() (sem FK declarada em types.ts),
// então tipamos a linha manualmente.
type ContractRow = {
  id: string;
  lead_id: string | null;
  package_name: string | null;
  total_amount: number;
  signal_amount: number | null;
  discount: number | null;
  status: ContractStatus;
  notes: string | null;
  created_at: string;
  leads: { name: string | null; tipo_ensaio: string | null } | null;
  payments: PaymentLedgerItem[] | null;
};

const DEFAULT_PAGE_SIZE = 20;
const CONTRACT_SELECT = `
  *,
  leads ( name, tipo_ensaio ),
  payments ( id, amount, method, installments, status, due_at, paid_at, is_signal, notes, created_at )
`;

type ContractQueryOptions = {
  page?: number;
  pageSize?: number;
  status?: ContractStatus | "closed" | "all";
  query?: string;
};

function sanitizeSearchTerm(value: string) {
  return value.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim();
}

export async function getContracts(
  options: ContractQueryOptions = {},
): Promise<PaginatedResult<ContractWithBalance>> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const empty = { items: [], total: 0, page, pageSize, pageCount: 1 };
  if (!hasSupabaseServerEnv()) return empty;

  try {
    const supabase = createSupabaseServerClient();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = supabase
      .from("contracts")
      .select(CONTRACT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (options.status === "closed") {
      query = query.in("status", ["quitado", "cancelado"]);
    } else if (options.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }

    const search = sanitizeSearchTerm(options.query ?? "");
    if (search) {
      const { data: leads } = await supabase
        .from("leads")
        .select("id")
        .or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
        .limit(200);
      const leadIds = (leads ?? []).map((lead) => lead.id).filter(Boolean);
      const textFilters = [`package_name.ilike.%${search}%`, `notes.ilike.%${search}%`];
      const filters = leadIds.length > 0
        ? [...textFilters, `lead_id.in.(${leadIds.join(",")})`]
        : textFilters;
      query = query.or(filters.join(","));
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("getContracts", error.message);
      return empty;
    }

    const rows = (data ?? []) as unknown as ContractRow[];
    const total = count ?? rows.length;

    const items = rows.map((row) => {
      const valor_pago = (row.payments ?? [])
        .filter((p) => p.status === "pago")
        .reduce((s, p) => s + Number(p.amount), 0);
      const net_amount = Math.max(0, Number(row.total_amount) - Number(row.discount ?? 0));

      return {
        id: row.id,
        lead_id: row.lead_id,
        cliente: row.leads?.name ?? null,
        tipo_ensaio: row.leads?.tipo_ensaio ?? null,
        package_name: row.package_name,
        total_amount: Number(row.total_amount),
        signal_amount: Number(row.signal_amount ?? 0),
        discount: Number(row.discount ?? 0),
        net_amount,
        valor_pago,
        saldo: Math.max(0, net_amount - valor_pago),
        status: row.status,
        notes: row.notes,
        created_at: row.created_at,
        payments: [...(row.payments ?? [])].sort((a, b) => {
          const da = a.due_at ?? a.paid_at ?? a.created_at;
          const db = b.due_at ?? b.paid_at ?? b.created_at;
          return new Date(da).getTime() - new Date(db).getTime();
        }),
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (err) {
    console.error("getContracts threw", err);
    return empty;
  }
}
