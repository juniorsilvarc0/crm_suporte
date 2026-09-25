import type { SupabaseClient } from "@supabase/supabase-js";

import { toCustomerSummary } from "@/features/customers/lib/customer-display";
import {
  CUSTOMER_SITUATIONS,
  type CustomerListParams,
  type CustomerSituation,
  type CustomerSummary,
  type CustomersPage,
} from "@/features/customers/types";
import { searchTokens } from "@/lib/formatters/search-text";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const CUSTOMERS_PAGE_SIZE = 25;

// Colunas explícitas de propósito: search_name e created_by_user_id não saem
// do servidor, e nada daqui encosta em support_contracts — o selo já está em
// customers.contract_status.
export const CUSTOMER_LIST_SELECT =
  "id, legal_name, trade_name, cnpj, contract_status, archived_at, created_at";
const CUSTOMER_SUMMARY_SELECT = "id, legal_name, trade_name, cnpj, contract_status, archived_at";

const MAX_QUERY_LENGTH = 100;
const MAX_OPTIONS = 20;

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isCustomerSituation(value: unknown): value is CustomerSituation {
  return CUSTOMER_SITUATIONS.some((situation) => situation === value);
}

/**
 * Lê os filtros da URL de /app/clientes. Valor fora da allowlist vira o padrão
 * em vez de erro: link velho ou editado à mão abre a lista inteira.
 */
export function parseCustomerListParams(searchParams: SearchParams): CustomerListParams {
  const situacao = firstParam(searchParams.situacao);
  const page = Number.parseInt(firstParam(searchParams.page) ?? "", 10);

  return {
    q: (firstParam(searchParams.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    situacao: isCustomerSituation(situacao) ? situacao : "todas",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/**
 * Filtros da lista, sem ordem nem página: a contagem de socorro (ver
 * getCustomersPage) repete exatamente o mesmo recorte.
 *
 * A busca é um `ilike` por token em search_name (nome fantasia + razão social +
 * CNPJ, normalizados no banco). Os tokens só têm [a-z0-9] — sem `.or()` e sem
 * nada para escapar no filtro do PostgREST.
 */
function buildListQuery(
  supabase: SupabaseClient<Database>,
  params: CustomerListParams,
  head: boolean
) {
  let query = supabase.from("customers").select(CUSTOMER_LIST_SELECT, { count: "exact", head });

  for (const token of searchTokens(params.q)) {
    query = query.ilike("search_name", `%${token}%`);
  }

  switch (params.situacao) {
    case "arquivadas":
      return query.not("archived_at", "is", null);
    case "sem":
      query = query.is("contract_status", null);
      break;
    case "ativo":
    case "suspenso":
    case "encerrado":
      query = query.eq("contract_status", params.situacao);
      break;
  }
  return query.is("archived_at", null);
}

/**
 * Paginação real server-side (`count: "exact"` + `range`), no molde do legado.
 *
 * Leitura resiliente (AGENTS §4), mas com `failed`: erro loga e devolve página
 * vazia MARCADA, para a tela dizer "não foi possível carregar" em vez de
 * "nenhuma empresa cadastrada".
 */
export async function getCustomersPage(params: CustomerListParams): Promise<CustomersPage> {
  const pageSize = CUSTOMERS_PAGE_SIZE;
  const failed = (page: number): CustomersPage => ({
    items: [],
    total: 0,
    page,
    pageSize,
    pageCount: 1,
    failed: true,
  });

  if (!hasSupabaseAdminEnv()) return failed(params.page);

  try {
    const supabase = createSupabaseAdminClient();
    const fetchPage = (page: number) => {
      const from = (page - 1) * pageSize;
      return buildListQuery(supabase, params, false)
        .order("search_name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
    };

    let page = params.page;
    let result = await fetchPage(page);

    // Página além do fim (link antigo, ou a última empresa da página foi
    // arquivada): com count, o PostgREST responde 416/PGRST103 em vez de lista
    // vazia. Conta de novo e abre a última página que existe — não é falha.
    if (result.error?.code === "PGRST103" && page > 1) {
      const { count, error } = await buildListQuery(supabase, params, true);
      if (!error && count !== null) {
        page = Math.min(page, Math.max(1, Math.ceil(count / pageSize)));
        result = await fetchPage(page);
      }
    }

    if (result.error) {
      console.error("getCustomersPage failed", result.error.message);
      return failed(page);
    }

    const total = result.count ?? 0;
    return {
      items: (result.data ?? []).map((row) => ({
        ...toCustomerSummary(row),
        created_at: row.created_at,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      failed: false,
    };
  } catch (error) {
    console.error("getCustomersPage threw", error);
    return failed(params.page);
  }
}

/**
 * Opções do seletor de empresa (GET /api/customers): só ATIVAS — arquivada
 * não recebe vínculo novo. Sem token, as primeiras por nome.
 *
 * LANÇA em erro: a rota responde 500, e o seletor mostra "Tentar de novo" em
 * vez de uma lista vazia que pareceria "nenhuma empresa encontrada".
 */
export async function searchCustomerOptions(
  supabase: SupabaseClient<Database>,
  options: { q: string; limit: number }
): Promise<CustomerSummary[]> {
  let query = supabase
    .from("customers")
    .select(CUSTOMER_SUMMARY_SELECT)
    .is("archived_at", null);

  for (const token of searchTokens(options.q)) {
    query = query.ilike("search_name", `%${token}%`);
  }

  const limit = Number.isInteger(options.limit)
    ? Math.min(MAX_OPTIONS, Math.max(1, options.limit))
    : MAX_OPTIONS;
  const { data, error } = await query
    .order("search_name", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toCustomerSummary);
}
