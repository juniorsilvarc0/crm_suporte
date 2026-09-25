import { upsertAppointmentFromWebhook } from "@/features/appointments/queries/webhook-mutations";
import { appointmentWebhookSchema } from "@/features/appointments/schemas/webhook";
import { createDealForAppointment } from "@/features/deals/queries/webhook-mutations";
import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { findLeadByPhone } from "@/features/leads/queries/webhook-mutations";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";

// GET /api/integracao/appointments — lista agendamentos.
//   ?from=ISO  ?to=ISO  ?status=  ?phone=  ?limit=(1-500, def 100)
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const sp = new URL(request.url).searchParams;
  const status = sp.get("status")?.trim();
  const from = sp.get("from")?.trim();
  const to = sp.get("to")?.trim();
  const phone = sp.get("phone")?.trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 500);

  let query = supabase
    .from("appointments")
    .select("*, lead:leads(name, phone, normalized_phone)")
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (status) query = query.filter("status", "eq", status);
  if (from) query = query.gte("scheduled_at", from);
  if (to) query = query.lte("scheduled_at", to);
  if (phone) {
    const lead = await findLeadByPhone(supabase, phone);
    if (!lead) return ok({ appointments: [] });
    query = query.eq("lead_id", lead.id);
  }

  const { data, error } = await query;
  if (error) return fail(error.message, 500);
  return ok({ appointments: data ?? [] });
}

// POST /api/integracao/appointments — cria/atualiza (vincula ao lead pelo phone).
export async function POST(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const body = await readJsonBody(request);
  if (body.error) return fail("invalid_json", 400);
  const parsed = appointmentWebhookSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("invalid_payload", 422, { fields: parsed.error.flatten().fieldErrors });
  }

  try {
    const lead = await findLeadByPhone(supabase, parsed.data.phone);
    const appointment = await upsertAppointmentFromWebhook(supabase, {
      ...parsed.data,
      leadId: lead?.id,
    });

    // Criar o agendamento também gera um card no funil (etapa 'agendado'),
    // vinculado ao lead. Idempotente por appointment_id — retry não duplica.
    let deal = null;
    if (lead?.id) {
      deal = await createDealForAppointment(supabase, {
        leadId: lead.id,
        appointmentId: appointment.id,
        tipo_ensaio: appointment.tipo_ensaio,
        scheduled_at: appointment.scheduled_at,
      });
    }

    return ok({ appointment, deal });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "erro_ao_salvar", 500);
  }
}
