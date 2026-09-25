import { z } from "zod";

import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { findLeadByPhone } from "@/features/leads/queries/webhook-mutations";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";

const createSchema = z.object({
  phone: z.string().min(8),
  scheduled_for: z.string().datetime().optional(), // quando retornar (default: agora)
  message: z.string().min(1).optional(),
  status: z.enum(["pendente", "enviado", "cancelado"]).default("pendente"),
});

// GET /api/integracao/followups — lista.  ?status=  ?phone=  ?limit=(1-500, def 100)
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const sp = new URL(request.url).searchParams;
  const status = sp.get("status")?.trim();
  const phone = sp.get("phone")?.trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 500);

  let query = supabase
    .from("followups")
    .select("*, lead:leads(name, phone, normalized_phone)")
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (status) query = query.filter("status", "eq", status);
  if (phone) {
    const lead = await findLeadByPhone(supabase, phone);
    if (!lead) return ok({ followups: [] });
    query = query.eq("lead_id", lead.id);
  }

  const { data, error } = await query;
  if (error) return fail(error.message, 500);
  return ok({ followups: data ?? [] });
}

// POST /api/integracao/followups — agenda/registra um follow-up para o lead.
export async function POST(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const body = await readJsonBody(request);
  if (body.error) return fail("invalid_json", 400);
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("invalid_payload", 422, { fields: parsed.error.flatten().fieldErrors });
  }

  const lead = await findLeadByPhone(supabase, parsed.data.phone);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("followups")
    .insert({
      lead_id: lead?.id ?? null,
      scheduled_for: parsed.data.scheduled_for ?? now,
      status: parsed.data.status,
      message: parsed.data.message ?? null,
      sent_at: parsed.data.status === "enviado" ? now : null,
    })
    .select()
    .single();
  if (error) return fail(error.message, 500);

  return ok({ followup: data });
}
