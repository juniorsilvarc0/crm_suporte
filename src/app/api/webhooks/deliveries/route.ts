import { NextResponse } from "next/server";
import { z } from "zod";

import { getWebhookDeliveries } from "@/features/webhooks/queries/get-webhooks";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const filterSchema = z.object({
  subscription: z.uuid().optional(),
  status: z.enum(["pending", "processing", "retry", "sent", "dead_letter", "skipped"]).optional(),
});

/** As entregas mais recentes (admin), de um destino e/ou de um status. */
export async function GET(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase admin não está configurado neste ambiente." }, { status: 500 });
  }

  const search = new URL(request.url).searchParams;
  const filter = filterSchema.safeParse({
    subscription: search.get("subscription") || undefined,
    status: search.get("status") || undefined,
  });
  if (!filter.success) return NextResponse.json({ ok: false, message: "Filtro inválido." }, { status: 400 });

  const deliveries = await getWebhookDeliveries(createSupabaseAdminClient(), {
    subscriptionId: filter.data.subscription,
    status: filter.data.status,
  });
  if (!deliveries) {
    return NextResponse.json({ ok: false, message: "Não foi possível ler as entregas." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deliveries });
}
