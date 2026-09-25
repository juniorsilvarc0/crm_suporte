import { createDealFromWebhook } from "@/features/deals/queries/webhook-mutations";
import { dealWebhookSchema } from "@/features/deals/schemas/webhook";
import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { findLeadByPhone } from "@/features/leads/queries/webhook-mutations";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";

// GET /api/integracao/deals — lista cards do funil (deals).
//   ?phone=  ?stage=  ?limit=(1-500, def 100)
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const sp = new URL(request.url).searchParams;
  const stage = sp.get("stage")?.trim();
  const phone = sp.get("phone")?.trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 500);

  let query = supabase
    .from("deals")
    .select("*, lead:leads!inner(name, phone, normalized_phone, archived_at)")
    .is("removed_at", null)
    .is("lead.archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (stage) query = query.eq("stage", stage);
  if (phone) {
    const lead = await findLeadByPhone(supabase, phone);
    if (!lead) return ok({ deals: [] });
    query = query.eq("lead_id", lead.id);
  }

  const { data, error } = await query;
  if (error) return fail(error.message, 500);
  return ok({ deals: data ?? [] });
}

// POST /api/integracao/deals — cria um card do funil para um lead (pelo phone).
// Cada chamada cria um card novo (permite N cards por cliente recorrente).
export async function POST(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const body = await readJsonBody(request);
  if (body.error) return fail("invalid_json", 400);
  const parsed = dealWebhookSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("invalid_payload", 422, { fields: parsed.error.flatten().fieldErrors });
  }

  try {
    const lead = await findLeadByPhone(supabase, parsed.data.phone);
    if (!lead) return fail("lead_not_found", 404);

    // Etapa: default 'novo'; se informada, precisa existir em board_columns.
    const stage = parsed.data.stage ?? "novo";
    const { data: column } = await supabase
      .from("board_columns")
      .select("key")
      .eq("key", stage)
      .maybeSingle();
    if (!column) return fail("stage_invalido", 400);

    const deal = await createDealFromWebhook(supabase, {
      ...parsed.data,
      leadId: lead.id,
      stage,
      source: "agent",
    });
    return ok({ deal });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "erro_ao_salvar", 500);
  }
}
