import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getWebhookSubscriptions, SUBSCRIPTION_SELECT, toWebhookSubscription } from "@/features/webhooks/queries/get-webhooks";
import { webhookCreateSchema } from "@/features/webhooks/schemas/webhook";
import { auditWebhook } from "@/features/webhooks/server/audit";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/security/ssrf-guard";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const NO_ADMIN = { ok: false, message: "Supabase admin não está configurado neste ambiente." };

/** Os destinos de webhook (admin). O segredo nunca sai daqui: só se existe. */
export async function GET() {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return NextResponse.json(NO_ADMIN, { status: 500 });

  const subscriptions = await getWebhookSubscriptions(createSupabaseAdminClient());
  if (!subscriptions) {
    return NextResponse.json({ ok: false, message: "Não foi possível ler os destinos." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, subscriptions });
}

/**
 * Cadastra um destino (admin). O CRM GERA o segredo da assinatura e o devolve
 * uma vez só, nesta resposta: depois disso ele só existe no Vault (e no
 * destino, que o guarda para conferir a assinatura).
 */
export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return NextResponse.json(NO_ADMIN, { status: 500 });

  const body = await readJsonBody(request);
  if (body.error) return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });

  const parsed = webhookCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Revise os campos destacados.", errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  let url: string;
  try {
    url = assertSafeUrl(parsed.data.url).toString();
  } catch (error) {
    const message = error instanceof UnsafeUrlError ? error.message : "URL inválida.";
    return NextResponse.json({ ok: false, message, errors: { url: [message] } }, { status: 422 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("webhook_subscriptions")
    .insert({ name: parsed.data.name, url, events: parsed.data.events, created_by_user_id: auth.viewer.id })
    .select(SUBSCRIPTION_SELECT)
    .single();
  if (error || !data) {
    console.error("[POST /api/webhooks]", error?.code, error?.message);
    return NextResponse.json({ ok: false, message: "Não foi possível salvar o destino." }, { status: 500 });
  }

  const secret = randomBytes(32).toString("hex");
  const { error: secretError } = await supabase.rpc("set_webhook_subscription_secret", {
    p_subscription_id: data.id,
    p_value: secret,
  });
  if (secretError) {
    // Destino sem segredo não envia nada (o despachante recusa): desfaz o cadastro.
    // Só o código vai para o log (o pedido levava o segredo).
    console.error("[POST /api/webhooks] segredo", secretError.code);
    const { error: undoError } = await supabase.from("webhook_subscriptions").delete().eq("id", data.id);
    if (undoError) console.error("[POST /api/webhooks] desfazer", undoError.code, undoError.message);
    return NextResponse.json({ ok: false, message: "Não foi possível gerar o segredo." }, { status: 500 });
  }

  await auditWebhook(supabase, "subscription.created", { by: auth.viewer.id, subscriptionId: data.id });
  // O segredo em texto puro sai só aqui: a tela o mostra para cópia e não tem
  // como lê-lo de novo.
  return NextResponse.json(
    { ok: true, subscription: { ...toWebhookSubscription(data), hasSecret: true }, secret },
    { headers: { "Cache-Control": "no-store" } }
  );
}
