import { NextResponse } from "next/server";

import { getChatIntegrationSecret, getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { registerUazapiWebhook, UAZAPI_WEBHOOK_EVENTS } from "@/features/chat/lib/connection/uazapi";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recadastra o webhook da instância na uazapi (admin): o MESMO endereço e o
 * MESMO segredo de hoje, com a lista de eventos atual do CRM
 * (`UAZAPI_WEBHOOK_EVENTS`). Não toca na sessão do WhatsApp: sem QR, sem
 * logout, sem trocar segredo. Serve para quando a lista de eventos muda (o
 * `connection`, 2026-10-13) ou quando o cadastro se perde do lado da uazapi:
 * o "Reconectar" do painel só pede o QR e não recadastra.
 *
 * É POST pelo mesmo motivo do QR: age no provedor, e a trava de origem do
 * proxy só cobre escrita.
 */
export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const supabase = createSupabaseAdminClient();
  let integration: Awaited<ReturnType<typeof getUazapiIntegration>>;
  let secret: string | null = null;
  try {
    integration = await getUazapiIntegration(supabase);
    if (integration) secret = await getChatIntegrationSecret(supabase, integration.id, "webhook_secret");
  } catch (error) {
    console.error("[connection/webhook] leitura da integração falhou:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, message: "Não foi possível ler a integração agora. Tente de novo." }, { status: 503 });
  }
  if (!integration) {
    return NextResponse.json({ ok: false, message: "Instância uazapi não configurada." }, { status: 409 });
  }
  // O segredo nasce na 1ª conexão (persist). Sem ele não há o que recadastrar:
  // o caminho é salvar as credenciais de novo.
  if (!secret) {
    return NextResponse.json(
      { ok: false, message: "A integração não tem segredo de webhook. Salve as credenciais de novo." },
      { status: 409 }
    );
  }

  // O mesmo endereço que o persist registra (as duas rotas montam igual).
  const publicBase = (process.env.APP_PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const webhookUrl = `${publicBase}/api/chat/webhook/uazapi?s=${encodeURIComponent(secret)}`;

  try {
    await registerUazapiWebhook(integration.apiUrl, integration.token, webhookUrl);
  } catch (error) {
    // Só o começo da mensagem ("uazapi webhook <status>"): o corpo da resposta
    // pode repetir a URL, que leva o segredo.
    const head = error instanceof Error ? error.message.split(":")[0] : "erro";
    console.warn("[connection/webhook] recadastro recusado:", head);
    return NextResponse.json(
      { ok: false, message: "A uazapi não aceitou o cadastro do webhook. Tente de novo." },
      { status: 502 }
    );
  }

  console.info(`[connection/webhook] webhook recadastrado (${UAZAPI_WEBHOOK_EVENTS.join(", ")}) por ${auth.viewer.id}`);
  return NextResponse.json({ ok: true, events: [...UAZAPI_WEBHOOK_EVENTS] });
}
