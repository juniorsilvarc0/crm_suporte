import type { LeadSale } from "@/features/financeiro/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

// `.in()` com lista gigante estoura o tamanho da URL do PostgREST — mesmo
// limite adotado em getLeadAttributions.
const CHUNK = 200;

type PaymentRow = {
  method: string | null;
};

type ContractRow = {
  id: string;
  lead_id: string | null;
  package_name: string | null;
  total_amount: number | null;
  discount: number | null;
  status: LeadSale["status"];
  notes: string | null;
  created_at: string;
  payments: PaymentRow[] | null;
};

function toSale(row: ContractRow): LeadSale {
  const payments = row.payments ?? [];
  const total = Number(row.total_amount ?? 0);
  const discount = Number(row.discount ?? 0);

  return {
    id: row.id,
    leadId: row.lead_id ?? "",
    procedureName: row.package_name,
    totalAmount: total,
    discount,
    netAmount: Math.max(0, total - discount),
    status: row.status,
    createdAt: row.created_at,
    notes: row.notes,
    method: (payments[0]?.method ?? null) as LeadSale["method"],
  };
}

/**
 * Vendas por lead, para o bloco "Vendas" do modal do lead.
 *
 * Mesma forma de getLeadAttributions: busca por lote de ids, leitura
 * resiliente (loga e devolve vazio em vez de derrubar a página), e o chamador
 * decide o que fazer com quem não tem venda.
 */
export async function getLeadSales(
  leadIds: string[]
): Promise<Map<string, LeadSale[]>> {
  const result = new Map<string, LeadSale[]>();
  const unique = [...new Set(leadIds.filter(Boolean))];
  if (unique.length === 0 || !hasSupabaseServerEnv()) return result;

  try {
    const supabase = createSupabaseServerClient();

    for (let index = 0; index < unique.length; index += CHUNK) {
      const { data, error } = await supabase
        .from("contracts")
        .select(
          "id, lead_id, package_name, total_amount, discount, status, notes, created_at, payments(method)"
        )
        .in("lead_id", unique.slice(index, index + CHUNK))
        .order("created_at", { ascending: false });

      if (error) {
        console.error("getLeadSales failed", error.message);
        return result;
      }

      for (const row of (data ?? []) as unknown as ContractRow[]) {
        if (!row.lead_id) continue;
        const current = result.get(row.lead_id) ?? [];
        current.push(toSale(row));
        result.set(row.lead_id, current);
      }
    }

    return result;
  } catch (error) {
    console.error("getLeadSales threw", error);
    return result;
  }
}
