import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { escapeLikePattern } from "@/features/chat/lib/search-term";
import { catalogErrorBody, mapCatalogError } from "@/features/tickets/lib/map-ticket-error";
import {
  catalogRootErrorMessage,
  ticketCategoryCreateSchema,
} from "@/features/tickets/schemas/catalog";
import type { TicketCategoryOption } from "@/features/tickets/types";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const ROUTE = "[POST /api/ticket-categories]";

// As colunas de TicketCategoryOption; nunca select("*").
const CATEGORY_SELECT = "id, name, product_id, parent_id, archived_at";

type Db = SupabaseClient<Database>;

/**
 * Cria a categoria (4f, admin): geral ou de uma fila, e opcionalmente filha de
 * outra. O trigger guard_ticket_category decide as regras e a rota traduz
 * (422, no campo): 2 níveis (CATEGORY_TOO_DEEP), mesma fila da mãe
 * (CATEGORY_PRODUCT_MISMATCH: a subcategoria manda o product_id da mãe), mãe
 * arquivada, fila arquivada; fila ou mãe inexistente saem da FK. Nome repetido
 * entre as ativas do mesmo lugar (fila + mãe) → 409 `duplicate` com a que já
 * tem o nome.
 */
export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = ticketCategoryCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: catalogRootErrorMessage(parsed.error) ?? "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { name, product_id, parent_id } = parsed.data;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("ticket_categories")
    .insert({ name, product_id, parent_id })
    .select(CATEGORY_SELECT)
    .single();

  if (error) {
    // 23505 aqui só pode ser ticket_categories_name_active_uidx (o id é gerado).
    const item =
      error.code === "23505"
        ? await findActiveSibling(supabase, name, product_id, parent_id)
        : undefined;
    const mapped = mapCatalogError(error, "category_create");
    if (mapped.status >= 500) console.error(ROUTE, error.code, error.message);
    return NextResponse.json(catalogErrorBody(mapped, item), { status: mapped.status });
  }

  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}

/**
 * A categoria ativa com o nome no mesmo lugar (fila + mãe, nulos iguais, como
 * ticket_categories_name_active_uidx). `*` é curinga no PostgREST: vira `_` e o
 * nome é conferido aqui (molde de POST /api/products). 2º uso
 * (api/ticket-categories/[id]): duplicado. Falhar ao reler só tira o item do 409.
 */
async function findActiveSibling(
  supabase: Db,
  name: string,
  productId: string | null,
  parentId: string | null
): Promise<TicketCategoryOption | undefined> {
  let query = supabase
    .from("ticket_categories")
    .select(CATEGORY_SELECT)
    .ilike("name", escapeLikePattern(name).replaceAll("*", "_"))
    .is("archived_at", null);
  query = productId ? query.eq("product_id", productId) : query.is("product_id", null);
  query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);

  const { data, error } = await query.limit(10);
  if (error) console.error(ROUTE, "categoria existente", error.message);
  return data?.find((row) => row.name.toLowerCase() === name.toLowerCase());
}
