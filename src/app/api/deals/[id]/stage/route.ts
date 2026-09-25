import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { syncLeadStatusFromDeals } from "@/features/deals/queries/sync-lead-status";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  stage: z.string().trim().min(1),
});

// Move um deal (card do funil) para outra etapa — usado pelo arrastar do Kanban.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Card inválido." }, { status: 400 });
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
    return NextResponse.json({ ok: false, message: "Etapa inválida." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // Valida o destino contra as colunas reais do board (categorias dinâmicas) e
  // lê o stage_type para carimbar ganho/perdido.
  const { data: column } = await supabase
    .from("board_columns")
    .select("key, stage_type")
    .eq("key", parsed.data.stage)
    .maybeSingle();

  if (!column) {
    return NextResponse.json(
      { ok: false, message: "Categoria inexistente." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const wonLost =
    column.stage_type === "won"
      ? { won_at: now, lost_at: null }
      : column.stage_type === "lost"
        ? { won_at: null, lost_at: now }
        : { won_at: null, lost_at: null };

  const { data, error } = await supabase
    .from("deals")
    .update({ stage: parsed.data.stage, ...wonLost })
    .eq("id", id)
    .is("removed_at", null)
    .select("id, lead_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Card não encontrado." }, { status: 404 });
  }

  // O card é a verdade; `leads.status` é a projeção que a lista de leads e o
  // dashboard leem. Sem isto os dois continuam contando a etapa antiga.
  if (data.lead_id) {
    await syncLeadStatusFromDeals(supabase, { leadId: data.lead_id });
  }

  revalidatePath("/app/funil");
  revalidatePath("/app/leads");
  revalidatePath("/app");
  return NextResponse.json({ ok: true, message: "Etapa atualizada." });
}
