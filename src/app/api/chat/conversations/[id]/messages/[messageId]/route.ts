import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  deleteUazapiMessage,
  editUazapiMessage,
} from "@/features/chat/lib/senders/uazapi";
import {
  canDeleteMessage,
  canEditMessage,
} from "@/features/chat/lib/message-actions";
import {
  canDeleteNote,
  canEditNote,
  isNoteMessage,
} from "@/features/chat/lib/note-actions";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { getIntegrationCredentials } from "@/features/chat/lib/connection/integration";
import type { ChatMessage } from "@/features/chat/types";
import type { Json } from "@/lib/supabase/types";

// Editar e apagar uma mensagem já enviada.
//
// Regra que vale para os dois: **o banco só é tocado depois do 200 do
// provedor**. Gravar antes deixaria o CRM afirmando uma coisa e o celular do
// contato mostrando outra — e não há como saber, depois, qual das duas é a
// verdade.
//
// A mensagem é sempre carregada com `conversation_id = [id]`. Sem esse filtro,
// um id vindo do cliente editaria ou apagaria mensagem de outro contato —
// mesma defesa de `resolveQuotedExternalId`.

type Params = { params: Promise<{ id: string; messageId: string }> };

type LoadedContext = {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  message: ChatMessage;
  apiUrl: string;
  token: string;
  lastMessageAt: string | null;
};

type BaseContext = {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  message: ChatMessage;
  conv: { integration_id: string | null; last_message_at: string | null };
};

/**
 * Conversa + mensagem, sem tocar em integração.
 *
 * A **anotação interna** para aqui: ela nunca foi ao WhatsApp, então exigir
 * credencial da uazapi para editá-la recusaria a ação numa conversa sem
 * integração — e o motivo do erro ("conversa sem integração") não teria nada a
 * ver com o que a pessoa tentou fazer.
 */
async function loadMessage(
  conversationId: string,
  messageId: string
): Promise<BaseContext | NextResponse> {
  const supabase = createSupabaseAdminClient();

  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("id, integration_id, last_message_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  const { data: message } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (!message) {
    return NextResponse.json({ error: "Mensagem não encontrada." }, { status: 404 });
  }

  return { supabase, message: message as ChatMessage, conv };
}

/**
 * Carrega mensagem + credenciais da uazapi, ou devolve a resposta de erro
 * pronta. Os dois métodos precisam exatamente disto, na mesma ordem.
 */
async function loadContext(
  conversationId: string,
  messageId: string
): Promise<LoadedContext | NextResponse> {
  const base = await loadMessage(conversationId, messageId);
  if (base instanceof NextResponse) return base;
  const { supabase, message, conv } = base;

  const integration = await getIntegrationCredentials(supabase, conv.integration_id);
  if (!integration) {
    return NextResponse.json({ error: "Conversa sem integração." }, { status: 400 });
  }

  return {
    supabase,
    message,
    apiUrl: integration.apiUrl,
    token: integration.token,
    lastMessageAt: conv.last_message_at,
  };
}

/** 403 padrão de quem tenta mexer em anotação que não é sua. */
function notNoteAuthor() {
  return NextResponse.json(
    { error: "Só quem escreveu a anotação pode alterá-la." },
    { status: 403 }
  );
}

/** Erro do provedor: vira 502 com o motivo, sem vazar a URL da instância. */
function providerError(action: string, err: unknown) {
  console.error(`[message ${action}] provedor recusou:`, err);
  return NextResponse.json(
    {
      error:
        action === "edit"
          ? "O WhatsApp não permitiu editar esta mensagem."
          : "O WhatsApp não permitiu apagar esta mensagem.",
    },
    { status: 502 }
  );
}

/** PATCH — edita o texto (ou a legenda) de uma mensagem nossa. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  try {
    const { id, messageId } = await params;
    const { text } = (await request.json()) as { text?: unknown };

    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Texto obrigatório." }, { status: 400 });
    }

    // ── Anotação interna: caminho LOCAL, sem provedor ────────────────
    // Ela nunca saiu do nosso banco, então editar é um UPDATE e pronto. Não há
    // janela de 15 minutos (não existe celular do outro lado mostrando a versão
    // antiga) nem prévia da conversa a corrigir (nota não vira prévia).
    const base = await loadMessage(id, messageId);
    if (base instanceof NextResponse) return base;

    if (isNoteMessage(base.message)) {
      if (!canEditNote(base.message, auth.viewer.id)) return notNoteAuthor();

      const { data: updated, error: noteErr } = await base.supabase
        .from("chat_messages")
        .update({
          content: text.trim(),
          metadata: {
            ...((base.message.metadata ?? {}) as Record<string, Json>),
            editedAt: new Date().toISOString(),
          },
        })
        .eq("id", base.message.id)
        .select()
        .single();
      if (noteErr) throw noteErr;
      return NextResponse.json({ message: updated });
    }

    const ctx = await loadContext(id, messageId);
    if (ctx instanceof NextResponse) return ctx;
    const { supabase, message, apiUrl, token } = ctx;

    // Mesmo predicado que decide o item do menu. Se divergirem, o operador vê
    // uma opção que a rota recusa.
    if (!canEditMessage(message, Date.now())) {
      return NextResponse.json(
        { error: "Esta mensagem não pode mais ser editada." },
        { status: 409 }
      );
    }

    const newText = text.trim();
    let result;
    try {
      result = await editUazapiMessage(apiUrl, token, message.external_id as string, newText);
    } catch (err) {
      return providerError("edit", err);
    }

    // ⚠️ A edição gera um `messageid` NOVO no WhatsApp. Sem gravá-lo, o
    // `messages_update` seguinte chega com um id que não casa com nada: os
    // ticks congelam, e o eco da edição entra como mensagem duplicada (a chave
    // de dedup é `conversation_id, external_id`).
    const metadata = {
      ...((message.metadata ?? {}) as Record<string, Json>),
      editedAt: new Date().toISOString(),
    };

    const { data: updated, error: updErr } = await supabase
      .from("chat_messages")
      .update({
        content: newText,
        metadata,
        ...(result.messageid ? { external_id: result.messageid } : {}),
      })
      .eq("id", message.id)
      .select()
      .single();
    if (updErr) throw updErr;

    // Se era a última da conversa, a prévia da lista ficou desatualizada.
    // O marcador de tipo (`[image]`) vai junto: é ele que a lista lateral lê
    // para desenhar o ícone e, sem ele, a conversa de uma foto passaria a
    // parecer uma mensagem de texto.
    await refreshPreviewIfLatest(supabase, id, message, previewFor(message, newText));

    return NextResponse.json({ message: updated });
  } catch (err) {
    console.error("[PATCH /api/chat/conversations/[id]/messages/[messageId]]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE — apaga para todos. */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  try {
    const { id, messageId } = await params;

    // Anotação interna: some do nosso banco e ponto. Nenhum provedor envolvido.
    const base = await loadMessage(id, messageId);
    if (base instanceof NextResponse) return base;

    if (isNoteMessage(base.message)) {
      if (!canDeleteNote(base.message, auth.viewer.id)) return notNoteAuthor();

      const { data: updated, error: noteErr } = await base.supabase
        .from("chat_messages")
        .update({ is_deleted: true, content: null })
        .eq("id", base.message.id)
        .select()
        .single();
      if (noteErr) throw noteErr;
      return NextResponse.json({ message: updated });
    }

    const ctx = await loadContext(id, messageId);
    if (ctx instanceof NextResponse) return ctx;
    const { supabase, message, apiUrl, token } = ctx;

    if (!canDeleteMessage(message)) {
      return NextResponse.json(
        { error: "Só é possível apagar mensagens enviadas por você." },
        { status: 409 }
      );
    }

    try {
      await deleteUazapiMessage(apiUrl, token, message.external_id as string);
    } catch (err) {
      return providerError("delete", err);
    }

    // Conteúdo e mídia saem junto: "apagada" que continua pesquisável ou
    // visível na prévia não está apagada. A busca já filtra `is_deleted`, mas o
    // texto seguiria no banco sem motivo.
    const { data: updated, error: updErr } = await supabase
      .from("chat_messages")
      .update({ is_deleted: true, content: null, media_url: null })
      .eq("id", message.id)
      .select()
      .single();
    if (updErr) throw updErr;

    await refreshPreviewIfLatest(supabase, id, message, "Mensagem apagada");

    return NextResponse.json({ message: updated });
  } catch (err) {
    console.error("[DELETE /api/chat/conversations/[id]/messages/[messageId]]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Prévia da conversa no mesmo formato de `buildPreview` (upsert-message): texto
 * puro em mensagem de texto, `[tipo] legenda` em mídia.
 */
function previewFor(message: ChatMessage, text: string): string {
  const body = message.type === "text" ? text : `[${message.type}] ${text}`.trim();
  return body.slice(0, 120);
}

/**
 * Atualiza a prévia da conversa quando a mensagem mexida era a última.
 *
 * Sem isto, apagar a última mensagem deixa o texto apagado à mostra na lista
 * lateral — que é justamente onde ele fica mais tempo na tela.
 *
 * Nota interna não conta como "última": ela não vira prévia (trigger de
 * `chat_messages`), então uma nota depois da mensagem não pode impedir a
 * prévia de ser corrigida.
 */
async function refreshPreviewIfLatest(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  conversationId: string,
  message: ChatMessage,
  preview: string
) {
  const { data: latest } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .neq("type", "note")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.id !== message.id) return;

  const { error } = await supabase
    .from("chat_conversations")
    .update({ last_message_preview: preview })
    .eq("id", conversationId);
  if (error) console.error("[message] atualizar prévia falhou:", error);
}
