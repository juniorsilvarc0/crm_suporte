import { NextResponse } from "next/server";

import { contractCreateSchema } from "@/features/contracts/schemas/contract";
import { cadastroErrorResponse } from "@/features/customers/lib/cadastro-error-response";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Contrato só é escrito pela RPC: o service_role não tem INSERT em
// support_contracts, e a RPC confere de novo o admin ATIVO, trava a empresa e
// grava contrato + produtos numa transação.
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

  const parsed = contractCreateSchema.safeParse(body.data);
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

  const input = parsed.data;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("create_support_contract", {
    p_actor_id: auth.viewer.id,
    p_customer_id: input.customer_id,
    p_status: input.status,
    p_starts_on: input.starts_on,
    p_monthly_amount: input.monthly_amount,
    p_billing_day: input.billing_day,
    p_product_ids: input.product_ids,
    // null = chave ausente: some do JSON e a RPC usa o default (sem plano,
    // prazo indeterminado).
    p_plan_id: input.plan_id ?? undefined,
    p_ends_on: input.ends_on ?? undefined,
  });

  if (error) {
    return cadastroErrorResponse("[POST /api/contracts]", error);
  }

  return NextResponse.json({ ok: true, message: "Contrato criado.", contract: { id: data } });
}
