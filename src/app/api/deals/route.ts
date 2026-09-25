import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { syncLeadStatusFromDeals } from "@/features/deals/queries/sync-lead-status";
import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cria um card do funil (deal) para um lead existente — usado pelo diálogo
// "Novo card" do board (sessão do dashboard). Cada chamada cria um card novo,
// então um cliente recorrente ganha vários cards sem duplicar o contato.
const schema = z.object({
  leadId: z.string().regex(UUID_RE, "Lead inválido."),
  stage: z.string().trim().min(1).default("novo"),
  tipo_ensaio: z.string().trim().min(1).optional(),
  valor: z.coerce.number().nonnegative().optional(),
  scheduled_at: z.string().datetime().optional(),
  title: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 });
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

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();

  const { data: column } = await supabase
    .from("board_columns")
    .select("key")
    .eq("key", parsed.data.stage)
    .maybeSingle();
  if (!column) {
    return NextResponse.json({ ok: false, message: "Categoria inexistente." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("deals")
    .insert({
      lead_id: parsed.data.leadId,
      stage: parsed.data.stage,
      tipo_ensaio: parsed.data.tipo_ensaio ?? null,
      valor: parsed.data.valor ?? null,
      scheduled_at: parsed.data.scheduled_at ?? null,
      title: parsed.data.title ?? null,
      notes: parsed.data.notes ?? null,
      source: "manual",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  // Card novo em etapa avançada precisa levar o lead junto (ver sync-lead-status).
  await syncLeadStatusFromDeals(supabase, { leadId: parsed.data.leadId });

  revalidatePath("/app/funil");
  revalidatePath("/app/leads");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, id: data.id, message: "Card criado." });
}
