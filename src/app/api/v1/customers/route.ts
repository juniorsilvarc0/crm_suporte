import { CUSTOMER_API_SELECT, customerListQuerySchema, toApiCustomer } from "@/lib/api/v1/cadastros";
import { afterCursorFilter, cursorPage, searchParamsOf } from "@/lib/api/v1/cursor";
import { apiPage, invalidInput, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { searchTokens } from "@/lib/formatters/search-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Empresas em ordem de `updated_at` crescente, com cursor. `?cnpj=` é
 * igualdade exata (com ou sem máscara); arquivada só com `include_archived`.
 */
export const GET = withApi(
  { route: "/api/v1/customers", scopes: ["customers:read"] },
  async ({ request, requestId, supabase }) => {
    const parsed = customerListQuerySchema.safeParse(searchParamsOf(request));
    if (!parsed.success) return invalidInput(requestId, parsed.error);
    const params = parsed.data;

    let query = supabase.from("customers").select(CUSTOMER_API_SELECT);
    if (!params.include_archived) query = query.is("archived_at", null);
    if (params.cnpj) query = query.eq("cnpj", params.cnpj);
    // Tokens só com [a-z0-9]: entram no ilike sem escape (search-text.ts).
    for (const token of searchTokens(params.q)) {
      query = query.ilike("search_name", `%${token}%`);
    }
    if (params.updated_since) query = query.gte("updated_at", params.updated_since);
    if (params.cursor) query = query.or(afterCursorFilter(params.cursor));

    const { data, error } = await query
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(params.limit + 1);
    if (error) {
      console.error(`[api/v1] ${requestId} customers`, error.message);
      return unavailable(requestId, "as empresas");
    }

    const page = cursorPage(data ?? [], params.limit);
    return apiPage(page.items.map(toApiCustomer), page.nextCursor);
  }
);
