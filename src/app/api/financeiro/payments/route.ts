import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recomputeContractStatus } from "@/features/financeiro/queries/recompute-contract-status";
import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const schema = z.object({
  contract_id: z.string().uuid("Contrato inválido."),
  lead_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive("Informe o valor."),
  method: z.enum(["pix", "credito", "debito", "dinheiro", "link", "parcelado"]),
  installments: z.coerce.number().int().min(1).max(6).default(1),
  is_signal: z.boolean().default(false),
  status: z.enum(["pago", "pendente"]).default("pago"),
  due_at: z.string().datetime({ offset: true }).optional().nullable(),
  paid_at: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

export async function POST(request: Request) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Não autorizado." }, { status: 401 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();

  // Valida que o contrato existe
  const { data: contract, error: cErr } = await supabase
    .from("contracts")
    .select("id, total_amount, discount, lead_id")
    .eq("id", parsed.data.contract_id)
    .maybeSingle();

  if (cErr || !contract) {
    return NextResponse.json({ ok: false, message: "Contrato não encontrado." }, { status: 404 });
  }

  const { error } = await supabase.from("payments").insert({
    ...parsed.data,
    lead_id: parsed.data.lead_id ?? contract.lead_id,
    paid_at:
      parsed.data.status === "pago"
        ? parsed.data.paid_at ?? new Date().toISOString()
        : null,
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  await recomputeContractStatus(supabase, parsed.data.contract_id);

  revalidatePath("/app/financeiro");
  return NextResponse.json({ ok: true });
}
