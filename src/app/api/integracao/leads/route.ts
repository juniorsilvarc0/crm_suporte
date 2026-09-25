import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { upsertLeadFromWebhook } from "@/features/leads/queries/webhook-mutations";
import { leadWebhookSchema } from "@/features/leads/schemas/webhook";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";

// GET /api/integracao/leads — lista/busca leads.
//   ?q=  (nome ou telefone)  ?status=  ?source=  ?limit=(1-200, def 50)  ?page=(def 1)
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const sp = new URL(request.url).searchParams;
  const q = sp.get("q")?.trim();
  const status = sp.get("status")?.trim();
  const source = sp.get("source")?.trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const page = Math.max(Number(sp.get("page")) || 1, 1);
  const offset = (page - 1) * limit;

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (source) query = query.filter("source", "eq", source);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const clauses = [`name.ilike.%${q}%`];
    if (digits) clauses.push(`normalized_phone.ilike.%${digits}%`);
    query = query.or(clauses.join(","));
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return fail(error.message, 500);

  return ok({ leads: data ?? [], page, pageSize: limit, total: count ?? 0 });
}

// POST /api/integracao/leads — cria/atualiza (upsert pelo telefone). Mesmo
// contrato do webhook /api/webhooks/n8n/lead, mas devolve o lead resultante.
export async function POST(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const body = await readJsonBody(request);
  if (body.error) return fail("invalid_json", 400);

  const parsed = leadWebhookSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("invalid_payload", 422, { fields: parsed.error.flatten().fieldErrors });
  }

  try {
    const lead = await upsertLeadFromWebhook(supabase, parsed.data);
    return ok({ lead });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "erro_ao_salvar", 500);
  }
}
