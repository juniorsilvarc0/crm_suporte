import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recomputeContractStatus } from "@/features/financeiro/queries/recompute-contract-status";
import { resolveContractLeadId } from "@/features/financeiro/queries/resolve-client";
import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  lead_id: z.string().uuid().optional().nullable(),
  new_client_name: z.string().trim().min(2).max(120).optional().nullable(),
  package_name: z.string().trim().min(1).max(120),
  total_amount: z.coerce.number().positive("Informe o valor total."),
  signal_amount: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  status: z.enum(["aberto", "quitado", "cancelado"]).default("aberto"),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "ID inválido." }, { status: 400 });
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
  const { new_client_name, lead_id, ...contractData } = parsed.data;

  const resolved = await resolveContractLeadId(supabase, { leadId: lead_id, newClientName: new_client_name });
  if ("error" in resolved) {
    return NextResponse.json({ ok: false, message: `Erro ao criar cliente: ${resolved.error}` }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("contracts")
    .update({ ...contractData, lead_id: resolved.leadId })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Venda não encontrada." }, { status: 404 });
  }

  await recomputeContractStatus(supabase, id);

  revalidatePath("/app/financeiro");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "ID inválido." }, { status: 400 });
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: current, error: currentError } = await supabase
    .from("contracts")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (currentError) {
    return NextResponse.json({ ok: false, message: currentError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ ok: false, message: "Venda não encontrada." }, { status: 404 });
  }

  const { error: paymentsError } = await supabase.from("payments").delete().eq("contract_id", id);
  if (paymentsError) {
    return NextResponse.json({ ok: false, message: paymentsError.message }, { status: 500 });
  }

  const { error } = await supabase.from("contracts").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/financeiro");
  return NextResponse.json({ ok: true });
}
