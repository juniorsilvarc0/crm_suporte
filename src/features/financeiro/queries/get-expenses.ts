import type { Expense, PaginatedResult } from "@/features/financeiro/types";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

const DEFAULT_PAGE_SIZE = 20;

type ExpenseQueryOptions = {
  page?: number;
  pageSize?: number;
  status?: "pago" | "pendente" | "all";
  query?: string;
};

function sanitizeSearchTerm(value: string) {
  return value.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim();
}

export async function getExpenses(
  options: ExpenseQueryOptions = {},
): Promise<PaginatedResult<Expense>> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const empty = { items: [], total: 0, page, pageSize, pageCount: 1 };
  if (!hasSupabaseServerEnv()) return empty;

  try {
    const supabase = createSupabaseServerClient();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = supabase
      .from("expenses")
      .select("*", { count: "exact" })
      .order("status", { ascending: false }) // pendente > pago alfabeticamente, desc = pendente primeiro
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (options.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }

    const search = sanitizeSearchTerm(options.query ?? "");
    if (search) {
      query = query.or(`description.ilike.%${search}%,vendor.ilike.%${search}%,notes.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("getExpenses", error.message);
      return empty;
    }

    const total = count ?? data?.length ?? 0;

    return {
      items: (data ?? []) as Expense[],
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (err) {
    console.error("getExpenses threw", err);
    return empty;
  }
}
