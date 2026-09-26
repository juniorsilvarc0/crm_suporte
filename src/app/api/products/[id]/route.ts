import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { escapeLikePattern } from "@/features/chat/lib/search-term";
import type { ProductOption } from "@/features/products/types";
import { catalogErrorBody, mapCatalogError } from "@/features/tickets/lib/map-ticket-error";
import { catalogRootErrorMessage, productPatchSchema } from "@/features/tickets/schemas/catalog";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[PATCH /api/products/[id]]";

// As colunas de ProductOption; nunca select("*").
const PRODUCT_SELECT = "id, name, niche, color, archived_at";

type Db = SupabaseClient<Database>;
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

/**
 * Edição da fila (4f, admin): nome, nicho, cor, arquivar e reativar. Grava só
 * as chaves enviadas. Arquivar o que já está arquivado não troca a data do 1º
 * arquivamento (nem reativar o que está ativo mexe em nada): sem mudança, o
 * item volta sem gravar. A fila arquivada some do "Novo ticket" e continua nos
 * tickets que já a tinham. Nome repetido entre as ativas, ao renomear ou ao
 * reativar → 409 `duplicate` com a fila que já tem o nome (molde de POST
 * /api/products).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Fila inválida." }, { status: 400 });
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

  const parsed = productPatchSchema.safeParse(body.data);
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
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (readError) return failure(readError);
  if (!current) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Fila não encontrada." },
      { status: 404 }
    );
  }

  const { archived, ...fields } = parsed.data;
  const patch: ProductUpdate = { ...fields };
  if (archived !== undefined && archived !== (current.archived_at !== null)) {
    patch.archived_at = archived ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, item: current });
  }

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .select(PRODUCT_SELECT)
    .maybeSingle();

  if (error) {
    // 23505 aqui só pode ser products_name_active_uidx (o id não muda).
    const item =
      error.code === "23505"
        ? await findActiveProduct(supabase, id, patch.name ?? current.name)
        : undefined;
    return failure(error, item);
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "Fila não encontrada." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, item: data });
}

/**
 * A OUTRA fila ativa com o nome (o índice compara sem caixa). `*` é curinga no
 * PostgREST (vira %) e o escape não o alcança: vira `_` e o nome é conferido
 * aqui, como em POST /api/products. Falhar ao reler só tira o item do 409.
 */
async function findActiveProduct(
  supabase: Db,
  id: string,
  name: string
): Promise<ProductOption | undefined> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .ilike("name", escapeLikePattern(name).replaceAll("*", "_"))
    .is("archived_at", null)
    .neq("id", id)
    .limit(10);
  if (error) console.error(ROUTE, "fila existente", error.message);
  return data?.find((row) => row.name.toLowerCase() === name.toLowerCase());
}

// Erro do banco no corpo do catálogo. O 500 é bug ou falha do banco: loga o
// code e a message (nunca o DETAIL, que traz a linha), e nada disso vai ao
// cliente.
function failure(cause: { code: string; message: string }, item?: ProductOption) {
  const mapped = mapCatalogError(cause, "product");
  if (mapped.status >= 500) console.error(ROUTE, cause.code, cause.message);
  return NextResponse.json(catalogErrorBody(mapped, item), { status: mapped.status });
}
