import { NextResponse } from "next/server";

import { contractUpdateSchema } from "@/features/contracts/schemas/contract";
import { cadastroErrorResponse } from "@/features/customers/lib/cadastro-error-response";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edição completa pela RPC (o formulário manda tudo). Empresa e situação não
// mudam aqui: o schema é .strict() e recusa as duas chaves; a situação tem
// rota própria (./status).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Contrato inválido." }, { status: 400 });
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

  const parsed = contractUpdateSchema.safeParse(body.data);
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
  const { error } = await supabase.rpc("update_support_contract", {
    p_actor_id: auth.viewer.id,
    p_contract_id: id,
    p_starts_on: input.starts_on,
    p_monthly_amount: input.monthly_amount,
    p_billing_day: input.billing_day,
    p_product_ids: input.product_ids,
    // null = chave ausente, e o default null da RPC GRAVA null: tira o plano,
    // prazo indeterminado.
    p_plan_id: input.plan_id ?? undefined,
    p_ends_on: input.ends_on ?? undefined,
  });

  if (error) {
    return cadastroErrorResponse("[PATCH /api/contracts/[id]]", error);
  }

  return NextResponse.json({ ok: true, message: "Contrato atualizado." });
}
