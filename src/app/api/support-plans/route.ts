import { NextResponse } from "next/server";

import { escapeLikePattern } from "@/features/chat/lib/search-term";
import { supportPlanCreateSchema } from "@/features/contracts/schemas/contract";
import { mapCadastroError } from "@/features/customers/lib/map-cadastro-error";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// As colunas de SupportPlanOption; nunca select("*").
const PLAN_SELECT = "id, name, description, archived_at";

// Plano é só o rótulo do contrato (sem preço), criado pelo "Criar «X»" do
// formulário de contrato. Mesmo desenho de POST /api/products.
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

  const parsed = supportPlanCreateSchema.safeParse(body.data);
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

  const { name, description } = parsed.data;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("support_plans")
    .insert({ name, description })
    .select(PLAN_SELECT)
    .single();

  if (error) {
    const mapped = mapCadastroError(error);

    // Nome repetido (support_plans_name_active_uidx): devolve o plano que já
    // existe, e o combobox o seleciona.
    if (mapped.status === 409 && mapped.field === "name") {
      // `*` é curinga no PostgREST (vira %) e o escape não o alcança: vira `_`
      // (um caractere qualquer) e o nome é conferido aqui, sem caixa.
      const { data: candidates, error: lookupError } = await supabase
        .from("support_plans")
        .select(PLAN_SELECT)
        .ilike("name", escapeLikePattern(name).replaceAll("*", "_"))
        .is("archived_at", null)
        .limit(10);
      if (lookupError) {
        console.error("[POST /api/support-plans] plano existente", lookupError.message);
      }
      const item = candidates?.find((row) => row.name.toLowerCase() === name.toLowerCase());

      return NextResponse.json(
        { ok: false, message: mapped.message, errors: { name: [mapped.message] }, item },
        { status: 409 }
      );
    }

    if (mapped.status >= 500) console.error("[POST /api/support-plans]", error.message);
    return NextResponse.json(
      {
        ok: false,
        message: mapped.message,
        errors: mapped.field ? { [mapped.field]: [mapped.message] } : undefined,
      },
      { status: mapped.status }
    );
  }

  return NextResponse.json({ ok: true, message: "Plano criado.", item: data });
}
