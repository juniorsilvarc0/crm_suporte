import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recomputeContractStatus } from "@/features/financeiro/queries/recompute-contract-status";
import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  amount: z.coerce.number().positive("Informe o valor."),
  method: z.enum(["pix", "credito", "debito", "dinheiro", "link", "parcelado"]).nullable().optional(),
  installments: z.coerce.number().int().min(1).max(6).default(1),
  is_signal: z.boolean().default(false),
  status: z.enum(["pago", "pendente", "estornado"]),
  due_at: z.string().datetime({ offset: true }).optional().nullable(),
  paid_at: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
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
  const { data: current, error: currentError } = await supabase
    .from("payments")
    .select("contract_id")
    .eq("id", id)
    .maybeSingle();

  if (currentError) {
    return NextResponse.json({ ok: false, message: currentError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ ok: false, message: "Pagamento não encontrado." }, { status: 404 });
  }

  const { error } = await supabase
    .from("payments")
    .update({
      ...parsed.data,
      paid_at:
        parsed.data.status === "pago"
          ? parsed.data.paid_at ?? new Date().toISOString()
          : null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  if (current.contract_id) {
    await recomputeContractStatus(supabase, current.contract_id);
  }

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
    .from("payments")
    .select("contract_id")
    .eq("id", id)
    .maybeSingle();

  if (currentError) {
    return NextResponse.json({ ok: false, message: currentError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ ok: false, message: "Pagamento não encontrado." }, { status: 404 });
  }

  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  if (current.contract_id) {
    await recomputeContractStatus(supabase, current.contract_id);
  }

  revalidatePath("/app/financeiro");
  return NextResponse.json({ ok: true });
}
