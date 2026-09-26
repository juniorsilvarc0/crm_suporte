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
//
// Conversa com ticket não se apaga (tickets_conversation_id_fkey é RESTRICT):
// apagaria o histórico do atendimento. Com wipe/deleteIntegration, os tickets
// são contados ANTES do logout, para a recusa deixar a instância conectada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HAS_TICKETS = "conversations_have_tickets";

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

  // 0) Vai apagar conversas? Nenhuma pode ter ticket. `head: true` só conta;
  //    o hint escolhe a FK do ticket para a conversa (a outra relação é o foco,
  //    chat_conversations.active_ticket_id).
  if (wipe === true || deleteIntegration === true) {
    const { count, error } = await supabase
      .from("tickets")
      .select("id, chat_conversations!tickets_conversation_id_fkey!inner(integration_id)", {
        count: "exact",
        head: true,
      })
      .eq("chat_conversations.integration_id", integration.id);
    if (error) {
      console.error("[connection/disconnect] contagem de tickets falhou:", error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível conferir os tickets das conversas." },
        { status: 500 }
      );
    }
    const tickets = count ?? 0;
    if (tickets > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: HAS_TICKETS,
          count: tickets,
          error: `As conversas desta instância têm ${ticketsLabel(tickets)}; apagar o chat apagaria o histórico do atendimento. Nada foi alterado.`,
        },
        { status: 409 }
      );
    }
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
      return conversationsDeleteFailed("limpeza pré-exclusão", convErr, loggedOut);
    }

    const { error: intErr } = await supabase
      .from("chat_integrations")
      .delete()
      .eq("id", integration.id);
    if (intErr) {
      console.error("[connection/disconnect] exclusão da instância falhou:", intErr);
      return NextResponse.json(
        { ok: false, error: "Não foi possível excluir a instância." },
        { status: 500 }
      );
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
      return conversationsDeleteFailed("wipe", error, loggedOut);
    }
    wiped = data?.length ?? 0;
  }

  return NextResponse.json({ ok: true, loggedOut, wiped });
}

function ticketsLabel(count: number): string {
  return count === 1 ? "1 ticket" : `${count} tickets`;
}

/**
 * O DELETE das conversas falhou. 23503 = um ticket nasceu entre a contagem e
 * o DELETE (a FK recusou): 409 como a contagem, só que depois do logout —
 * `loggedOut` diz à tela se a instância caiu. Em qualquer erro nada foi
 * apagado: o DELETE é um comando só.
 */
function conversationsDeleteFailed(
  step: string,
  error: { code?: string },
  loggedOut: boolean
) {
  if (error.code === "23503") {
    return NextResponse.json(
      {
        ok: false,
        reason: HAS_TICKETS,
        loggedOut,
        error:
          "Um ticket foi aberto numa conversa desta instância agora há pouco; nada foi apagado.",
      },
      { status: 409 }
    );
  }
  console.error(`[connection/disconnect] ${step} falhou:`, error);
  return NextResponse.json(
    { ok: false, error: "Não foi possível apagar o chat." },
    { status: 500 }
  );
}
