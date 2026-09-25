import { NextResponse } from "next/server";
import { z } from "zod";

import { escapeLikePattern } from "@/features/chat/lib/search-term";
import { mapCadastroError } from "@/features/customers/lib/map-cadastro-error";
import { isColorName } from "@/features/tags/schemas/colors";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// As colunas de ProductOption; nunca select("*").
const PRODUCT_SELECT = "id, name, niche, color, archived_at";

// Fase 3 só CRIA produto (a fila), pelo "Criar «X»" do formulário de contrato:
// nasce slate e sem nicho. Renomear, recolorir e arquivar chegam com a tela de
// filas. O banco confere de novo (checks de products).
const createSchema = z
  .object({
    name: z
      .string("Informe o nome do produto.")
      .trim()
      .min(2, "Use ao menos 2 caracteres.")
      .max(80, "Máximo de 80 caracteres."),
    // Vazio vira null: o banco recusa nicho em branco.
    niche: z
      .string()
      .trim()
      .max(80, "Máximo de 80 caracteres.")
      .nullish()
      .transform((value) => value || null),
    color: z.string().trim().refine(isColorName, "Cor inválida.").default("slate"),
  })
  .strict();

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

  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { name, niche, color } = parsed.data;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ name, niche, color })
    .select(PRODUCT_SELECT)
    .single();

  if (error) {
    const mapped = mapCadastroError(error);

    // Nome repetido (products_name_active_uidx): devolve o produto que já
    // existe, e o combobox o seleciona em vez de o operador procurar de novo.
    if (mapped.status === 409 && mapped.field === "name") {
      // `*` é curinga no PostgREST (vira %) e o escape não o alcança: vira `_`
      // (um caractere qualquer) e o nome é conferido aqui, como o índice
      // compara (sem caixa).
      const { data: candidates, error: lookupError } = await supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .ilike("name", escapeLikePattern(name).replaceAll("*", "_"))
        .is("archived_at", null)
        .limit(10);
      if (lookupError) {
        console.error("[POST /api/products] produto existente", lookupError.message);
      }
      const item = candidates?.find((row) => row.name.toLowerCase() === name.toLowerCase());

      return NextResponse.json(
        { ok: false, message: mapped.message, errors: { name: [mapped.message] }, item },
        { status: 409 }
      );
    }

    if (mapped.status >= 500) console.error("[POST /api/products]", error.message);
    return NextResponse.json(
      {
        ok: false,
        message: mapped.message,
        errors: mapped.field ? { [mapped.field]: [mapped.message] } : undefined,
      },
      { status: mapped.status }
    );
  }

  return NextResponse.json({ ok: true, message: "Produto criado.", item: data });
}
