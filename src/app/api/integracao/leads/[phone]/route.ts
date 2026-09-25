import { z } from "zod";

import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { findLeadByPhone } from "@/features/leads/queries/webhook-mutations";
import {
  isAmbiguousLeadStatusError,
  setLeadStatusFromSingleDeal,
} from "@/features/leads/queries/set-lead-status";
import { readJsonBody } from "@/lib/http/read-json-body";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const SOURCES = [
  "agencia",
  "anuncio",
  "particular",
  "indicacao",
  "whatsapp",
  "importado",
  "outro",
] as const;
const STATUSES = [
  "novo",
  "em_atendimento",
  "qualificado",
  "agendado",
  "compareceu",
  "cliente",
  "recorrente",
  "perdido",
] as const;

const patchSchema = z.object({
  name: z.string().min(1).nullish(),
  instagram_user: z.string().nullish(),
  email: z.string().nullish(),
  source: z.enum(SOURCES).optional(),
  status: z.enum(STATUSES).optional(),
  tipo_ensaio: z.string().nullish(),
  agencia_nome: z.string().nullish(),
  modelo_nome: z.string().nullish(),
  interesse: z.string().nullish(),
  valor_estimado: z.coerce.number().min(0).nullish(),
  is_recorrente: z.boolean().optional(),
  memoria_contexto: z.string().nullish(),
  notes: z.string().nullish(),
});

type Ctx = { params: Promise<{ phone: string }> };

// GET — detalhe do lead (com tags, agendamentos e follow-ups).
export async function GET(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { phone } = await params;

  const lead = await findLeadByPhone(auth.supabase, decodeURIComponent(phone));
  if (!lead) return fail("lead_not_found", 404);

  const [tagRes, apptRes, fupRes] = await Promise.all([
    auth.supabase.from("lead_tags").select("tags(id, name, color)").eq("lead_id", lead.id),
    auth.supabase
      .from("appointments")
      .select("*")
      .eq("lead_id", lead.id)
      .order("scheduled_at", { ascending: false }),
    auth.supabase
      .from("followups")
      .select("*")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false }),
  ]);

  const tags = (tagRes.data ?? []).map((r) => r.tags).filter(Boolean);
  return ok({
    lead: { ...lead, tags },
    appointments: apptRes.data ?? [],
    followups: fupRes.data ?? [],
  });
}

// PATCH — atualiza campos e/ou move a etapa (status).
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { phone } = await params;

  const lead = await findLeadByPhone(auth.supabase, decodeURIComponent(phone));
  if (!lead) return fail("lead_not_found", 404);

  const body = await readJsonBody(request);
  if (body.error) return fail("invalid_json", 400);
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("invalid_payload", 422, { fields: parsed.error.flatten().fieldErrors });
  }
  if (Object.keys(parsed.data).length === 0) return fail("nada_para_atualizar", 400);

  const profilePatch: Database["public"]["Tables"]["leads"]["Update"] = {
    ...parsed.data,
  };
  delete profilePatch.status;

  if (parsed.data.status) {
    try {
      await setLeadStatusFromSingleDeal(auth.supabase, {
        leadId: lead.id,
        status: parsed.data.status,
        leadPatch: profilePatch,
      });
    } catch (statusError) {
      return fail(
        isAmbiguousLeadStatusError(statusError)
          ? "multiple_active_deals_requires_deal_id"
          : "lead_status_sync_failed",
        isAmbiguousLeadStatusError(statusError) ? 409 : 500
      );
    }
  } else {
    const { error } = await auth.supabase
      .from("leads")
      .update({
        ...profilePatch,
        archived_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id);
    if (error) return fail(error.message, 500);
  }

  const { data, error: readError } = await auth.supabase
    .from("leads")
    .select()
    .eq("id", lead.id)
    .single();
  if (readError) return fail(readError.message, 500);

  return ok({ lead: data });
}

// DELETE mantém o contrato HTTP, mas arquiva a pessoa e preserva vínculos.
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { phone } = await params;

  const lead = await findLeadByPhone(auth.supabase, decodeURIComponent(phone));
  if (!lead) return fail("lead_not_found", 404);

  const { error } = await auth.supabase
    .from("leads")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", lead.id);
  if (error) return fail(error.message, 500);

  return ok({ deleted: true, archived: true, id: lead.id });
}
