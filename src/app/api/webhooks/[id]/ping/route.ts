import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { PING_EVENT } from "@/features/webhooks/catalog";
import { auditWebhook } from "@/features/webhooks/server/audit";
import { postWebhook } from "@/features/webhooks/server/send";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/security/ssrf-guard";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Teto de testes por administrador (mesmo motivo do teste do agente: sem ele o
// botão sondaria endereços em série). Por processo: com duas réplicas, o dobro.
const PINGS_PER_MINUTE = 10;

const idSchema = z.uuid();
type Params = { params: Promise<{ id: string }> };

/**
 * "Testar conexão" de um destino (admin): um `webhook.ping` assinado, na hora,
 * pelo mesmo envio das entregas (guarda de URL, segredo do Vault, cabeçalhos,
 * prazo). Não passa pela fila nem fica nela. Responde 200 com o desfecho em
 * `result`, inclusive quando o destino falha.
 */
export async function POST(_request: Request, { params }: Params) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase admin não está configurado neste ambiente." }, { status: 500 });
  }

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ ok: false, message: "Destino inválido." }, { status: 400 });

  const limit = rateLimit(`webhook-ping:${auth.viewer.id}`, PINGS_PER_MINUTE, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: `Muitos testes seguidos. Tente de novo em ${limit.retryAfter} s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data: subscription, error } = await supabase
    .from("webhook_subscriptions")
    .select("id, name, url")
    .eq("id", id.data)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, message: "Não foi possível ler o destino." }, { status: 500 });
  }
  if (!subscription) return NextResponse.json({ ok: false, message: "Destino não encontrado." }, { status: 404 });

  let target: URL;
  try {
    target = assertSafeUrl(subscription.url);
  } catch (urlError) {
    const message = urlError instanceof UnsafeUrlError ? urlError.message : "URL inválida.";
    return NextResponse.json({ ok: true, result: { error: `URL recusada: ${message}`, latencyMs: 0 } });
  }

  const { data: secret } = await supabase.rpc("get_webhook_subscription_secret", { p_subscription_id: subscription.id });
  if (!secret) {
    return NextResponse.json({ ok: true, result: { error: "Destino sem segredo de assinatura.", latencyMs: 0 } });
  }

  const eventId = randomUUID();
  const body = JSON.stringify({
    id: eventId,
    event: PING_EVENT,
    occurred_at: new Date().toISOString(),
    data: { subscription_id: subscription.id, name: subscription.name },
    ticket: null,
  });
  const result = await postWebhook(target, secret, { name: PING_EVENT, id: eventId, body });

  // O teste fica no registro, como qualquer pedido que saiu do CRM.
  await auditWebhook(supabase, PING_EVENT, {
    by: auth.viewer.id,
    subscriptionId: subscription.id,
    error: result.error,
    requestId: eventId,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
  });
  return NextResponse.json({ ok: true, result });
}
