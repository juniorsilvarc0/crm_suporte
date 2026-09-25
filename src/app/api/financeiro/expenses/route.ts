import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const schema = z.object({
  category: z.string().trim().min(1).max(80),
  // kind é inferido: recorrente = fixa, avulso = variavel
  kind: z.enum(["fixa", "variavel"]).optional(),
  description: z.string().trim().min(1).max(200),
  amount: z.coerce.number().positive("Informe o valor."),
  status: z.enum(["pago", "pendente"]).default("pendente"),
  due_at: z.string().datetime({ offset: true }).optional().nullable(),
  paid_at: z.string().datetime({ offset: true }).optional().nullable(),
  recurring: z.boolean().default(false),
  // Quantas vezes repetir (cria N registros com due_at avançando 1 mês cada).
  recurring_count: z.coerce.number().int().min(1).max(60).default(1),
  vendor: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

function addMonths(isoDate: string | null | undefined, months: number): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

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

  const { recurring_count, kind, ...base } = parsed.data;
  const inferredKind: "fixa" | "variavel" = kind ?? (base.recurring ? "fixa" : "variavel");

  // Parcelado (!recurring) → divide o valor total pelas parcelas.
  // Recorrente (recurring) → cada mês tem o valor cheio.
  const amountPerRecord =
    !base.recurring && recurring_count > 1
      ? Math.round((base.amount / recurring_count) * 100) / 100
      : base.amount;

  const records = Array.from({ length: recurring_count }, (_, i) => ({
    ...base,
    amount: amountPerRecord,
    kind: inferredKind,
    due_at: i === 0 ? base.due_at ?? null : addMonths(base.due_at, i),
    paid_at: base.status === "pago" ? base.paid_at ?? new Date().toISOString() : null,
    recurring: base.recurring,
  }));

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("expenses").insert(records);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  revalidatePath("/app/financeiro");
  return NextResponse.json({ ok: true, count: records.length });
}
