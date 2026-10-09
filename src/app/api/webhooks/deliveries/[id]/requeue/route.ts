import { NextResponse } from "next/server";
import { z } from "zod";

import { auditWebhook } from "@/features/webhooks/server/audit";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const idSchema = z.uuid();
type Params = { params: Promise<{ id: string }> };

/**
 * Reenvio manual (admin): uma entrega que esgotou as tentativas (dead_letter)
 * volta para a fila com as tentativas zeradas, e o worker a entrega no
 * próximo ciclo. Outra situação responde 409: só o que morreu se reenvia.
 */
export async function POST(_request: Request, { params }: Params) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase admin não está configurado neste ambiente." }, { status: 500 });
  }

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ ok: false, message: "Entrega inválida." }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("outbox_requeue", { p_id: id.data });
  if (error) {
    console.error("[POST /api/webhooks/deliveries/[id]/requeue]", error.code, error.message);
    return NextResponse.json({ ok: false, message: "Não foi possível reenviar." }, { status: 500 });
  }
  if (data !== true) {
    return NextResponse.json(
      { ok: false, message: "Só uma entrega que esgotou as tentativas pode ser reenviada." },
      { status: 409 }
    );
  }

  // Para a trilha, o destino da entrega (a leitura é só para o registro).
  const { data: delivery } = await supabase
    .from("event_outbox")
    .select("payload")
    .eq("id", id.data)
    .maybeSingle();
  const payload = delivery?.payload;
  const subscriptionId =
    payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.subscription_id === "string"
      ? payload.subscription_id
      : "";
  await auditWebhook(supabase, "delivery.requeued", {
    by: auth.viewer.id,
    subscriptionId,
    detail: { delivery_id: id.data },
  });
  return NextResponse.json({ ok: true });
}
