import type { Deal } from "@/features/deals/types";
import type { Lead, Tag } from "@/features/leads/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

type LeadWithTags = Omit<Lead, "tags"> & {
  lead_tags?: { tag: Tag | null }[] | null;
};
type DealRowWithLead = Omit<Deal, "lead"> & {
  lead: LeadWithTags | null;
};

const PAGE_SIZE = 1000;

function flattenLeadTags(lead: LeadWithTags | null): Lead | null {
  if (!lead) return null;
  const { lead_tags, ...rest } = lead;
  const tags = (lead_tags ?? [])
    .map((lt) => lt.tag)
    .filter((t): t is Tag => Boolean(t))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...rest, tags };
}

// Cards do funil = deals (N por lead). Cada agendamento vira um card próprio,
// então um cliente recorrente aparece com vários cards sem duplicar o contato.
// Leitura resiliente: sem Supabase configurado, cai em lista vazia sem quebrar.
export async function getDeals(): Promise<Deal[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = createSupabaseServerClient();
    const rows: DealRowWithLead[] = [];
    let from = 0;

    while (true) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("deals")
        .select("*, lead:leads!inner(*, lead_tags(tag:tags(*)))")
        .is("removed_at", null)
        .is("lead.archived_at", null)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        console.error("getDeals failed", error.message);
        return [];
      }

      rows.push(...((data ?? []) as unknown as DealRowWithLead[]));
      if ((data ?? []).length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    // Exclui deals de leads importados (histórico) — como getLeads faz com imported.
    return rows
      .filter((r) => !r.lead?.imported && !r.lead?.archived_at)
      .map((r) => ({ ...r, lead: flattenLeadTags(r.lead) }));
  } catch (error) {
    console.error("getDeals threw", error);
    return [];
  }
}
