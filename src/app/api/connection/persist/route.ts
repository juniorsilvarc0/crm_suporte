import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assertUazapiCredentials,
  getUazapiStatus,
  registerUazapiWebhook,
} from "@/features/chat/lib/connection/uazapi";
import { safeBaseUrl } from "@/features/chat/lib/connection/ssrf-guard";
import {
  ensureChatIntegrationSecret,
  setChatIntegrationSecret,
} from "@/features/chat/lib/connection/integration";

// Persiste as credenciais da instância uazapi (chat_integrations) e registra o
// webhook de entrada. É o que "acopla" a conexão ao chat: sem esta linha, envio
// e webhook não têm como resolver a integração.
//
// Nenhum segredo em tabela nem em env: `config` guarda só a `apiUrl`; o token
// da instância e o segredo do webhook (`?s=`) vão para o Vault.
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

  const findExisting = () =>
    supabase.from("chat_integrations").select("id").eq("provider", "uazapi").maybeSingle();

  // Upsert manual: 1 instância uazapi (single-tenant). O `unique (provider)`
  // do banco barra o segundo INSERT de dois cliques simultâneos (23505); aí
  // a linha que venceu é relida e atualizada.
  let integrationId: string;
  try {
    let { data: existing, error: findError } = await findExisting();
    if (findError) throw findError;

    if (!existing) {
      const { data, error } = await supabase
        .from("chat_integrations")
        .insert({
          name: "WhatsApp (uazapi)",
          provider: "uazapi",
          config: { apiUrl: base },
          is_active: true,
        })
        .select("id")
        .single();
      if (error?.code === "23505") {
        ({ data: existing, error: findError } = await findExisting());
        if (findError) throw findError;
      } else if (error || !data) {
        throw error ?? new Error("insert_failed");
      } else {
        existing = data;
      }
    }
    if (!existing) throw new Error("integration_not_found");
    integrationId = existing.id;

    const { error: updateError } = await supabase
      .from("chat_integrations")
      .update({ config: { apiUrl: base }, is_active: true, updated_at: now })
      .eq("id", integrationId);
    if (updateError) throw updateError;

    await setChatIntegrationSecret(supabase, integrationId, "token", token);
  } catch (error) {
    console.error("[connection/persist] gravar integração falhou:", error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível salvar as credenciais." },
      { status: 500 }
    );
  }

  // Segredo do webhook: gerado na primeira conexão e mantido nas seguintes,
  // para reconectar não invalidar um webhook já registrado. Trocar o segredo
  // é rotação, decisão explícita (menu Conexão, Fase 5). "Cria se ausente" é
  // atômico no banco: duas conexões simultâneas registram o MESMO segredo que
  // ficou no Vault — gerar e gravar aqui em passos separados deixaria a uazapi
  // com um e o Vault com outro, e todo webhook em 401.
  let secret: string;
  try {
    secret = await ensureChatIntegrationSecret(
      supabase,
      integrationId,
      "webhook_secret",
      randomBytes(32).toString("hex")
    );
  } catch (error) {
    console.error("[connection/persist] segredo do webhook falhou:", error);
    return NextResponse.json(
      { ok: false, error: "Credenciais salvas, mas o segredo do webhook não foi gerado." },
      { status: 500 }
    );
  }

  // Registra o webhook apontando para a nossa rota de entrada (com o secret).
  const publicBase = (
    process.env.APP_PUBLIC_URL || new URL(request.url).origin
  ).replace(/\/+$/, "");
  const webhookUrl = `${publicBase}/api/chat/webhook/uazapi?s=${encodeURIComponent(secret)}`;

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
