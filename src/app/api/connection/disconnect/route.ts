import { NextResponse } from "next/server";

import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { disconnectUazapi } from "@/features/chat/lib/connection/uazapi";

// Desconecta (logout) a instância uazapi. Modos:
//  - padrão: só logout. Mantém credenciais + chat → a página oferece reconectar
//    (mesma instância, conversas preservadas) ou trocar de instância.
//  - { wipe: true }: logout + apaga TODO o histórico do chat (conversas +
//    mensagens em cascata), mas MANTÉM a instância (credenciais).
//  - { deleteIntegration: true }: EXCLUI a instância do CRM — apaga o chat e
//    remove as credenciais (chat_integrations). A página volta ao formulário de
//    credenciais para conectar uma instância NOVA.
// Os leads NUNCA são tocados.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;

  const { wipe, deleteIntegration } = (await request
    .json()
    .catch(() => ({}))) as { wipe?: boolean; deleteIntegration?: boolean };

  const supabase = createSupabaseAdminClient();
  const integration = await getUazapiIntegration(supabase);
  if (!integration) {
    return NextResponse.json({ ok: false, reason: "no_integration" }, { status: 400 });
  }

  // 1) Logout da instância (não bloqueia as demais etapas se falhar).
  let loggedOut = false;
  try {
    await disconnectUazapi(integration.apiUrl, integration.token);
    loggedOut = true;
  } catch (err) {
    console.warn("[connection/disconnect] logout falhou:", err);
  }

  // 2) Excluir a instância = apaga o chat E remove as credenciais.
  if (deleteIntegration === true) {
    // Apaga as conversas ANTES de remover a integração: a FK é ON DELETE SET
    // NULL, então excluir a integração primeiro perderia o vínculo e deixaria
    // conversas órfãs.
    const { data: convs, error: convErr } = await supabase
      .from("chat_conversations")
      .delete()
      .eq("integration_id", integration.id)
      .select("id");
    if (convErr) {
      console.error("[connection/disconnect] limpeza pré-exclusão falhou:", convErr);
      return NextResponse.json({ ok: false, error: convErr.message }, { status: 500 });
    }

    const { error: intErr } = await supabase
      .from("chat_integrations")
      .delete()
      .eq("id", integration.id);
    if (intErr) {
      console.error("[connection/disconnect] exclusão da instância falhou:", intErr);
      return NextResponse.json({ ok: false, error: intErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      loggedOut,
      deleted: true,
      wiped: convs?.length ?? 0,
    });
  }

  // 3) Wipe opcional do chat (conversas → mensagens em cascata), mantendo a instância.
  let wiped = 0;
  if (wipe === true) {
    const { data, error } = await supabase
      .from("chat_conversations")
      .delete()
      .eq("integration_id", integration.id)
      .select("id");
    if (error) {
      console.error("[connection/disconnect] wipe falhou:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    wiped = data?.length ?? 0;
  }

  return NextResponse.json({ ok: true, loggedOut, wiped });
}
