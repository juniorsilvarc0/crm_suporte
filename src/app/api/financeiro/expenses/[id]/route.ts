import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  category: z.string().trim().min(1).max(80),
  kind: z.enum(["fixa", "variavel"]),
  description: z.string().trim().min(1).max(200),
  amount: z.coerce.number().positive("Informe o valor."),
  status: z.enum(["pago", "pendente"]),
  due_at: z.string().datetime({ offset: true }).optional().nullable(),
  paid_at: z.string().datetime({ offset: true }).optional().nullable(),
  recurring: z.boolean().default(false),
  vendor: z.string().trim().max(100).optional().nullable(),
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

  const supabase = createSupabaseAdminClient();
  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const updatePayload = (() => {
    if (
      body.data &&
      typeof body.data === "object" &&
      "action" in body.data &&
      body.data.action === "mark_paid"
    ) {
      return { success: true as const, data: { status: "pago" as const, paid_at: new Date().toISOString() } };
    }

    const parsed = schema.safeParse(body.data);
    if (!parsed.success) return parsed;
    return {
      success: true as const,
      data: {
        ...parsed.data,
        paid_at:
          parsed.data.status === "pago"
            ? parsed.data.paid_at ?? new Date().toISOString()
            : null,
      },
    };
  })();

  if ("success" in updatePayload && !updatePayload.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos.", errors: updatePayload.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("expenses")
    .update(updatePayload.data)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Despesa não encontrada." }, { status: 404 });
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
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Despesa não encontrada." }, { status: 404 });
  }

  revalidatePath("/app/financeiro");
  return NextResponse.json({ ok: true });
}
