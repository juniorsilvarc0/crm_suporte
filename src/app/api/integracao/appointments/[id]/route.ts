import { z } from "zod";

import {
  authorizeIntegration,
  fail,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  scheduled_at: z.string().datetime().optional(), // reagendar
  status: z
    .enum(["agendado", "confirmado", "compareceu", "faltou", "cancelado"])
    .optional(),
  tipo_ensaio: z.string().nullish(),
  duration_min: z.coerce.number().int().positive().nullish(),
  notes: z.string().nullish(),
});

type Ctx = { params: Promise<{ id: string }> };

// PATCH — reagenda / muda status / edita um agendamento.
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("id_invalido", 400);

  const body = await readJsonBody(request);
  if (body.error) return fail("invalid_json", 400);
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) {
    return fail("invalid_payload", 422, { fields: parsed.error.flatten().fieldErrors });
  }
  if (Object.keys(parsed.data).length === 0) return fail("nada_para_atualizar", 400);

  const { data, error } = await auth.supabase
    .from("appointments")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return fail(error.message, 500);
  if (!data) return fail("appointment_not_found", 404);

  return ok({ appointment: data });
}

// DELETE — cancela/remove o agendamento.
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("id_invalido", 400);

  const { error } = await auth.supabase.from("appointments").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ deleted: true, id });
}
