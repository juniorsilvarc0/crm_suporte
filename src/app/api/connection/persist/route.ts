import { NextResponse } from "next/server";

import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assertUazapiCredentials,
  getUazapiStatus,
  registerUazapiWebhook,
} from "@/features/chat/lib/connection/uazapi";
import { safeBaseUrl } from "@/features/chat/lib/connection/ssrf-guard";

// Persiste as credenciais da instância uazapi (chat_integrations) e registra o
// webhook de entrada. É o que "acopla" a conexão ao chat: sem esta linha, envio
// e webhook não têm como resolver a integração.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  let apiUrl: string;
  let token: string;
  try {
    const body = (await request.json()) as { apiUrl?: string; token?: string };
    apiUrl = (body.apiUrl ?? "").trim();
    token = (body.token ?? "").trim();
    assertUazapiCredentials(apiUrl, token); // lança em URL insegura / token curto
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Dados inválidos." },
      { status: 400 }
    );
  }

  const base = safeBaseUrl(apiUrl); // normalizada (sem barra final)

  // Valida que as credenciais REALMENTE respondem (bate no /instance/status)
  // ANTES de gravar. Assim uma URL/token errado retorna erro e o usuário reedita
  // — sem persistir uma config quebrada (que travaria o painel) e sem sobrescrever
  // uma config boa por um edit inválido. Instância válida ainda não conectada
  // responde 200 (não lança), então não bloqueia o fluxo normal do QR.
  try {
    await getUazapiStatus(base, token);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_credentials",
        error:
          "Não consegui validar a instância. Confira a URL do servidor e o token e tente de novo.",
        detail: detail.slice(0, 200),
      },
      { status: 422 }
    );
  }

  const now = new Date().toISOString();
  const supabase = createSupabaseAdminClient();

  // Upsert manual (não há unique em provider): 1 instância uazapi (single-tenant).
  const { data: existing } = await supabase
    .from("chat_integrations")
    .select("id")
    .eq("provider", "uazapi")
    .limit(1)
    .maybeSingle();

  let integrationId: string;
  if (existing) {
    const { error } = await supabase
      .from("chat_integrations")
      .update({
        config: { apiUrl: base, token },
        is_active: true,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    integrationId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("chat_integrations")
      .insert({
        name: "WhatsApp (uazapi)",
        provider: "uazapi",
        config: { apiUrl: base, token },
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "Falha ao salvar." },
        { status: 500 }
      );
    }
    integrationId = data.id;
  }

  // Registra o webhook apontando para a nossa rota de entrada (com o secret).
  const secret = process.env.UAZAPI_WEBHOOK_SECRET;
  const publicBase = (
    process.env.APP_PUBLIC_URL || new URL(request.url).origin
  ).replace(/\/+$/, "");
  const webhookUrl = `${publicBase}/api/chat/webhook/uazapi${
    secret ? `?s=${encodeURIComponent(secret)}` : ""
  }`;

  let webhookRegistered = false;
  let webhookError: string | null = null;
  try {
    await registerUazapiWebhook(base, token, webhookUrl);
    webhookRegistered = true;
  } catch (error) {
    webhookError = error instanceof Error ? error.message : "Falha ao registrar webhook.";
    console.warn("[connection/persist] webhook register failed:", webhookError);
  }

  return NextResponse.json({
    ok: true,
    integrationId,
    webhookRegistered,
    webhookUrl,
    webhookError,
  });
}
