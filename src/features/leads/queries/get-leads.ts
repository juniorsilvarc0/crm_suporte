import type { Lead, Tag } from "@/features/leads/types";
import {
  matchingLeadSources,
  matchingLeadStatuses,
  parseLeadEntryDate,
  sanitizeLeadSearch,
  type LeadSearchColumn,
} from "@/features/leads/lib/leads-search";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

type LeadRowWithTags = Omit<Lead, "tags"> & {
  lead_tags?: { tag: Tag | null }[] | null;
};

const PAGE_SIZE = 1000;

type GetLeadsOptions = {
  limit?: number;
  includeImported?: boolean;
};

function flattenTags(row: LeadRowWithTags): Lead {
  const { lead_tags, ...lead } = row;
  const tags = (lead_tags ?? [])
    .map((lt) => lt.tag)
    .filter((t): t is Tag => Boolean(t))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...lead, tags };
}

// Leitura resiliente: sem Supabase configurado (ou tabela ainda inexistente),
// retorna lista vazia para o dashboard cair em estado vazio sem quebrar.
export async function getLeads(options: GetLeadsOptions | number = {}): Promise<Lead[]> {
  if (!hasSupabaseServerEnv()) {
    return [];
  }

  try {
    const normalizedOptions =
      typeof options === "number" ? { limit: options } : options;
    const { limit, includeImported = false } = normalizedOptions;
    const supabase = createSupabaseServerClient();
    const rows: LeadRowWithTags[] = [];
    let from = 0;

    while (true) {
      const to = limit
        ? Math.min(from + PAGE_SIZE - 1, limit - 1)
        : from + PAGE_SIZE - 1;

      let query = supabase
        .from("leads")
        .select("*, lead_tags(tag:tags(*))")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (!includeImported) {
        query = query.or("imported.is.null,imported.eq.false");
      }

      const { data, error } = await query;
      if (error) {
        console.error("getLeads failed", error.message);
        return [];
      }

      rows.push(...((data ?? []) as unknown as LeadRowWithTags[]));
      if ((data ?? []).length < PAGE_SIZE || (limit && rows.length >= limit)) break;
      from += PAGE_SIZE;
    }

    return rows.map(flattenTags);
  } catch (error) {
    console.error("getLeads threw", error);
    return [];
  }
}

export const LEADS_PAGE_SIZE = 20;

const QUALIFIED_STATUSES = [
  "qualificado",
  "agendado",
  "compareceu",
  "cliente",
  "recorrente",
];
const AGENDADOS_STATUSES = ["agendado", "compareceu", "cliente", "recorrente"];

export type PaginatedLeads = {
  items: Lead[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

// Paginação real server-side (com contagem total via count: exact).
export async function getLeadsPage(
  options: {
    page?: number;
    pageSize?: number;
    searchColumn?: LeadSearchColumn;
    searchQuery?: string;
  } = {}
): Promise<PaginatedLeads> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, options.pageSize ?? LEADS_PAGE_SIZE));
  const empty: PaginatedLeads = { items: [], total: 0, page, pageSize, pageCount: 1 };

  if (!hasSupabaseServerEnv()) return empty;

  try {
    const supabase = createSupabaseServerClient();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const searchQuery = sanitizeLeadSearch(options.searchQuery ?? "");
    const searchColumn = options.searchColumn ?? "lead";

    let query = supabase
      .from("leads")
      .select("*, lead_tags(tag:tags(*))", { count: "exact" })
      .is("archived_at", null)
      .or("imported.is.null,imported.eq.false");

    if (searchQuery) {
      if (searchColumn === "lead") {
        query = query.or(
          `name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,normalized_phone.ilike.%${searchQuery}%`,
        );
      } else if (searchColumn === "contexto") {
        query = query.or(
          `tipo_ensaio.ilike.%${searchQuery}%,agencia_nome.ilike.%${searchQuery}%,interesse.ilike.%${searchQuery}%,notes.ilike.%${searchQuery}%`,
        );
      } else if (searchColumn === "origem") {
        const sources = matchingLeadSources(searchQuery);
        if (sources.length === 0) return empty;
        query = query.in("source", sources);
      } else if (searchColumn === "status") {
        const statuses = matchingLeadStatuses(searchQuery);
        if (statuses.length === 0) return empty;
        query = query.in("status", statuses);
      } else {
        const range = parseLeadEntryDate(searchQuery);
        if (!range) return empty;
        query = query.gte("created_at", range.from).lt("created_at", range.to);
      }
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("getLeadsPage failed", error.message);
      return empty;
    }

    const total = count ?? 0;
    const items = ((data ?? []) as unknown as LeadRowWithTags[]).map(flattenTags);

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  } catch (error) {
    console.error("getLeadsPage threw", error);
    return empty;
  }
}

export type LeadsSummary = { total: number; qualified: number; agendados: number };

// Resumo da base inteira via COUNT (head: true, sem transferir linhas), para o
// resumo não ficar preso à página atual.
export async function getLeadsSummary(): Promise<LeadsSummary> {
  const empty: LeadsSummary = { total: 0, qualified: 0, agendados: 0 };
  if (!hasSupabaseServerEnv()) return empty;

  try {
    const supabase = createSupabaseServerClient();
    const base = () =>
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null)
        .or("imported.is.null,imported.eq.false");

    const [totalRes, qualifiedRes, agendadosRes] = await Promise.all([
      base(),
      base().in("status", QUALIFIED_STATUSES),
      base().in("status", AGENDADOS_STATUSES),
    ]);

    return {
      total: totalRes.count ?? 0,
      qualified: qualifiedRes.count ?? 0,
      agendados: agendadosRes.count ?? 0,
    };
  } catch (error) {
    console.error("getLeadsSummary threw", error);
    return empty;
  }
}
