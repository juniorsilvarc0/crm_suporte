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
  status: z.enum(["pendente", "enviado", "cancelado"]).optional(),
  scheduled_for: z.string().datetime().optional(),
  message: z.string().nullish(),
});

type Ctx = { params: Promise<{ id: string }> };

// PATCH — reagenda / conclui (enviado) / cancela um follow-up.
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

  const patch = {
    ...parsed.data,
    ...(parsed.data.status === "enviado"
      ? { sent_at: new Date().toISOString() }
      : {}),
  };

  const { data, error } = await auth.supabase
    .from("followups")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return fail(error.message, 500);
  if (!data) return fail("followup_not_found", 404);

  return ok({ followup: data });
}

// DELETE — remove o follow-up.
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("id_invalido", 400);

  const { error } = await auth.supabase.from("followups").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ deleted: true, id });
}
