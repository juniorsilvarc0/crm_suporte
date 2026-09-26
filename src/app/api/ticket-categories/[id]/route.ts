import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { escapeLikePattern } from "@/features/chat/lib/search-term";
import { catalogErrorBody, mapCatalogError } from "@/features/tickets/lib/map-ticket-error";
import {
  catalogRootErrorMessage,
  ticketCategoryPatchSchema,
} from "@/features/tickets/schemas/catalog";
import type { TicketCategoryOption } from "@/features/tickets/types";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[PATCH /api/ticket-categories/[id]]";

// As colunas de TicketCategoryOption; nunca select("*").
const CATEGORY_SELECT = "id, name, product_id, parent_id, archived_at";

type Db = SupabaseClient<Database>;
type CategoryUpdate = Database["public"]["Tables"]["ticket_categories"]["Update"];

/**
 * Renomeia, arquiva e reativa a categoria (4f, admin). A fila e a mãe não mudam
 * depois de criada. Arquivar o que já está arquivado não troca a data do 1º
 * arquivamento: sem mudança, o item volta sem gravar. O trigger
 * guard_ticket_category recusa arquivar a mãe com filhas ativas e reativar a
 * filha de uma mãe arquivada (422 no campo `archived`). Nome repetido entre as
 * ativas do mesmo lugar, ao renomear ou reativar → 409 `duplicate` com a que já
 * tem o nome. A arquivada some do "Novo ticket" e continua nos tickets antigos.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Categoria inválida." }, { status: 400 });
  }

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

  const parsed = ticketCategoryPatchSchema.safeParse(body.data);
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

  const supabase = createSupabaseAdminClient();
  const { data: current, error: readError } = await supabase
    .from("ticket_categories")
    .select(CATEGORY_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (readError) return failure(readError);
  if (!current) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Categoria não encontrada." },
      { status: 404 }
    );
  }

  const { name, archived } = parsed.data;
  const patch: CategoryUpdate = name === undefined ? {} : { name };
  if (archived !== undefined && archived !== (current.archived_at !== null)) {
    patch.archived_at = archived ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, item: current });
  }

  const { data, error } = await supabase
    .from("ticket_categories")
    .update(patch)
    .eq("id", id)
    .select(CATEGORY_SELECT)
    .maybeSingle();

  if (error) {
    // 23505 aqui só pode ser ticket_categories_name_active_uidx (o id não muda).
    const item =
      error.code === "23505"
        ? await findActiveSibling(supabase, id, name ?? current.name, current)
        : undefined;
    return failure(error, item);
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Categoria não encontrada." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, item: data });
}

/**
 * A OUTRA categoria ativa com o nome no mesmo lugar (fila + mãe, nulos iguais,
 * como ticket_categories_name_active_uidx). `*` é curinga no PostgREST: vira
 * `_` e o nome é conferido aqui (molde de POST /api/products). 2º uso
 * (api/ticket-categories): duplicado. Falhar ao reler só tira o item do 409.
 */
async function findActiveSibling(
  supabase: Db,
  id: string,
  name: string,
  place: Pick<TicketCategoryOption, "product_id" | "parent_id">
): Promise<TicketCategoryOption | undefined> {
  let query = supabase
    .from("ticket_categories")
    .select(CATEGORY_SELECT)
    .ilike("name", escapeLikePattern(name).replaceAll("*", "_"))
    .is("archived_at", null)
    .neq("id", id);
  query = place.product_id
    ? query.eq("product_id", place.product_id)
    : query.is("product_id", null);
  query = place.parent_id ? query.eq("parent_id", place.parent_id) : query.is("parent_id", null);

  const { data, error } = await query.limit(10);
  if (error) console.error(ROUTE, "categoria existente", error.message);
  return data?.find((row) => row.name.toLowerCase() === name.toLowerCase());
}

// Erro do banco no corpo do catálogo. O 500 é bug ou falha do banco: loga o
// code e a message (nunca o DETAIL, que traz a linha), e nada disso vai ao
// cliente.
function failure(cause: { code: string; message: string }, item?: TicketCategoryOption) {
  const mapped = mapCatalogError(cause, "category_update");
  if (mapped.status >= 500) console.error(ROUTE, cause.code, cause.message);
  return NextResponse.json(catalogErrorBody(mapped, item), { status: mapped.status });
}
