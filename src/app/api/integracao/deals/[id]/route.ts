import { z } from "zod";

import { syncLeadStatusFromDeals } from "@/features/deals/queries/sync-lead-status";
import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { readJsonBody } from "@/lib/http/read-json-body";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  stage: z.string().trim().min(1).optional(), // mover de etapa (board_columns.key)
  tipo_ensaio: z.string().nullish(),
  valor: z.coerce.number().nonnegative().nullish(),
  scheduled_at: z.string().datetime().nullish(),
  title: z.string().nullish(),
  notes: z.string().nullish(),
});

type Ctx = { params: Promise<{ id: string }> };

// PATCH — move de etapa / edita um card do funil.
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("id_invalido", 400);

  const body = await readJsonBody(request);
  if (body.error) return fail("invalid_json", 400);
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("invalid_payload", 422, { fields: parsed.error.flatten().fieldErrors });
  }
  if (Object.keys(parsed.data).length === 0) return fail("nada_para_atualizar", 400);

  const patch: Database["public"]["Tables"]["deals"]["Update"] = { ...parsed.data };

  // Ao mover de etapa: valida o destino e carimba ganho/perdido pelo stage_type.
  if (parsed.data.stage) {
    const { data: column } = await supabase
      .from("board_columns")
      .select("key, stage_type")
      .eq("key", parsed.data.stage)
      .maybeSingle();
    if (!column) return fail("stage_invalido", 400);

    const now = new Date().toISOString();
    Object.assign(
      patch,
      column.stage_type === "won"
        ? { won_at: now, lost_at: null }
        : column.stage_type === "lost"
          ? { won_at: null, lost_at: now }
          : { won_at: null, lost_at: null }
    );
  }

  const { data, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", id)
    .is("removed_at", null)
    .select("*, lead:leads(name, phone, normalized_phone)")
    .maybeSingle();
  if (error) return fail(error.message, 500);
  if (!data) return fail("deal_not_found", 404);

  // Agente externo que move o card move o lead junto — mesma regra do funil.
  if (parsed.data.stage && data.lead_id) {
    await syncLeadStatusFromDeals(supabase, { leadId: data.lead_id });
  }

  return ok({ deal: data });
}

// DELETE — remove o card do funil sem apagar pessoa nem histórico de etapas.
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("id_invalido", 400);

  const { data, error } = await auth.supabase
    .from("deals")
    .update({ removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("lead_id")
    .maybeSingle();
  if (error) return fail(error.message, 500);

  // Sobrou card do lead? A projeção volta para o mais avançado que restou.
  if (data?.lead_id) {
    await syncLeadStatusFromDeals(auth.supabase, { leadId: data.lead_id });
  }

  return ok({ deleted: true, removed: true, id });
}
