import type { SupabaseClient } from "@supabase/supabase-js";

import { toCustomerSummary } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { normalizePhone } from "@/lib/formatters/phone";
import { searchTokens } from "@/lib/formatters/search-text";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const CONTACTS_PAGE_SIZE = 25;

// Colunas explícitas de propósito: search_name e normalized_phone só servem ao
// filtro, e a empresa vem pelas colunas do CustomerSummary — o selo já está em
// customers.contract_status, nada daqui encosta em support_contracts.
export const CONTACT_LIST_SELECT =
  "id, name, phone, last_message_at, customer:customers(id, legal_name, trade_name, cnpj, contract_status, archived_at)";

// Filtro "Empresa" da lista (?empresa=). "todos" é o padrão e fica fora da URL;
// valor fora da lista vira "todos" (parseContactListParams).
export const CONTACT_COMPANY_FILTERS = ["todos", "com", "sem"] as const;

export type ContactCompanyFilter = (typeof CONTACT_COMPANY_FILTERS)[number];

export type ContactListParams = {
  q: string;
  empresa: ContactCompanyFilter;
  page: number;
};

// Escrito à mão, nunca derivado do Row de contacts: só o que a tabela mostra.
export type ContactListItem = {
  id: string;
  name: string | null;
  phone: string;
  last_message_at: string | null;
  customer: CustomerSummary | null;
};

// `failed` = a leitura deu erro: a tela diz "não foi possível carregar", nunca
// "nenhum contato ainda".
export type ContactsPage = {
  items: ContactListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  failed: boolean;
};

const MAX_QUERY_LENGTH = 100;
// Abaixo disso o pedaço de número casa com quase todo telefone da base, e o
// termo cai na busca por nome como qualquer outro texto.
const MIN_PHONE_DIGITS = 4;

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isContactCompanyFilter(value: unknown): value is ContactCompanyFilter {
  return CONTACT_COMPANY_FILTERS.some((filter) => filter === value);
}

/**
 * Lê os filtros da URL de /app/contatos. Valor fora da allowlist vira o padrão
 * em vez de erro: link velho ou editado à mão abre a lista inteira.
 */
export function parseContactListParams(searchParams: SearchParams): ContactListParams {
  const empresa = firstParam(searchParams.empresa);
  const page = Number.parseInt(firstParam(searchParams.page) ?? "", 10);

  return {
    q: (firstParam(searchParams.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    empresa: isContactCompanyFilter(empresa) ? empresa : "todos",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/**
 * Pedaço de telefone digitado, ou `null` quando o termo é texto.
 *
 * Tira só a pontuação que se usa ao escrever um número ("(27) 99999-0000",
 * "+55 27 9999.0000"); sobrando só dígitos, a busca vai para normalized_phone,
 * que guarda o número sem o DDI 55 — por isso passa por `normalizePhone`.
 */
function phoneSearchDigits(query: string): string | null {
  const digits = query.replace(/[\s()+.-]/g, "");
  if (!/^\d+$/.test(digits) || digits.length < MIN_PHONE_DIGITS) return null;
  return normalizePhone(digits);
}

/**
 * Filtros da lista, sem ordem nem página: a contagem de socorro (ver
 * getContactsPage) repete exatamente o mesmo recorte.
 *
 * Telefone: um `ilike` em normalized_phone, que tem índice trgm. Texto: um
 * `ilike` por token em search_name (o nome, normalizado no banco). Nos dois
 * casos o padrão só tem [a-z0-9] — sem `.or()` e sem nada para escapar no
 * filtro do PostgREST.
 */
function buildListQuery(
  supabase: SupabaseClient<Database>,
  params: ContactListParams,
  head: boolean
) {
  let query = supabase
    .from("contacts")
    .select(CONTACT_LIST_SELECT, { count: "exact", head })
    .is("archived_at", null);

  const phone = phoneSearchDigits(params.q);
  if (phone) {
    query = query.ilike("normalized_phone", `%${phone}%`);
  } else {
    for (const token of searchTokens(params.q)) {
      query = query.ilike("search_name", `%${token}%`);
    }
  }

  switch (params.empresa) {
    case "com":
      return query.not("customer_id", "is", null);
    case "sem":
      return query.is("customer_id", null);
    default:
      return query;
  }
}

/**
 * Paginação real server-side (`count: "exact"` + `range`), no molde de
 * getCustomersPage. Quem falou por último aparece primeiro; quem nunca falou
 * vai para o fim, por nome. O `id` desempata para a página não repetir nem
 * pular linha entre um clique e outro.
 *
 * Leitura resiliente (AGENTS §4), mas com `failed`: erro loga e devolve página
 * vazia MARCADA, para a tela dizer "não foi possível carregar" em vez de
 * "nenhum contato ainda".
 */
export async function getContactsPage(params: ContactListParams): Promise<ContactsPage> {
  const pageSize = CONTACTS_PAGE_SIZE;
  const failed = (page: number): ContactsPage => ({
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
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
    };

    let page = params.page;
    let result = await fetchPage(page);

    // Página além do fim (link antigo, ou o último contato da página foi
    // arquivado): com count, o PostgREST responde 416/PGRST103 em vez de lista
    // vazia. Conta de novo e abre a última página que existe — não é falha.
    if (result.error?.code === "PGRST103" && page > 1) {
      const { count, error } = await buildListQuery(supabase, params, true);
      if (!error && count !== null) {
        page = Math.min(page, Math.max(1, Math.ceil(count / pageSize)));
        result = await fetchPage(page);
      }
    }

    if (result.error) {
      console.error("getContactsPage failed", result.error.message);
      return failed(page);
    }

    const total = result.count ?? 0;
    return {
      // Campo a campo, nunca com spread: coluna a mais que a consulta traga
      // não chega ao payload da página.
      items: (result.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        last_message_at: row.last_message_at,
        customer: row.customer ? toCustomerSummary(row.customer) : null,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      failed: false,
    };
  } catch (error) {
    console.error("getContactsPage threw", error);
    return failed(params.page);
  }
}
