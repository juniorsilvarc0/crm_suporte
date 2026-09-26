import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { sendUazapiText } from "@/features/chat/lib/senders/uazapi";
import { overridableFrom } from "@/features/chat/lib/delivery-status";
import { CLIENT_ID_PATTERN } from "@/features/chat/lib/outgoing-message";
import { resolveSignature, signMessage } from "@/features/chat/lib/signature";
import { resolveQuotedExternalId } from "@/features/chat/queries/resolve-quoted";
import { buildMessageLinkPreview } from "@/features/chat/lib/message-content";
import { resolveConversationChannelAddress } from "@/features/chat/lib/conversation-channel-address";
import { getIntegrationCredentials } from "@/features/chat/lib/connection/integration";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;
  // Quem está falando: define a assinatura e fica registrado na mensagem.
  const { viewer } = auth;

  try {
    const { id } = await params;
    const { content, kind, quotedMessageId, clientId } = (await request.json()) as {
      content: string;
      kind?: "note" | "text";
      /** Id da NOSSA chat_messages sendo respondida. */
      quotedMessageId?: string | null;
      /**
       * Identificador do envio, criado pela tela. Casa a bolha otimista com esta
       * linha e torna o reenvio idempotente.
       */
      clientId?: string | null;
    };

    if (!content?.trim()) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }

    // Charset restrito porque o valor entra num filtro do PostgREST — vírgula e
    // parêntese ali seriam sintaxe, não dado.
    if (clientId != null && !CLIENT_ID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();

    const { data: conv, error: convErr } = await supabase
      .from("chat_conversations")
      .select("id, external_id, contact_phone, integration_id")
      .eq("id", id)
      .single();

    if (convErr || !conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isNote = kind === "note";
    const now = new Date().toISOString();

    // --- Notas internas: nunca vão ao provedor, salvas só localmente ---------
    if (isNote) {
      const { data: note, error: noteErr } = await supabase
        .from("chat_messages")
        .insert({
          conversation_id: id,
          direction: "outbound",
          sender_type: "agent",
          type: "note",
          content,
          delivery_status: "sent",
          sent_by_user_id: viewer.id,
          created_at: now,
        })
        .select()
        .single();
      if (noteErr) throw noteErr;
      return NextResponse.json({ message: note });
    }

    // --- Texto de saída: resolve integração, insere pending, envia -----------
    const phone = resolveConversationChannelAddress(conv);
    if (!phone) {
      return NextResponse.json({ error: "No phone on conversation" }, { status: 400 });
    }

    const integration = await getIntegrationCredentials(supabase, conv.integration_id);
    if (!integration) {
      return NextResponse.json({ error: "No integration" }, { status: 400 });
    }

    /**
     * O mesmo `clientId` nunca vira duas mensagens.
     *
     * É o que torna o "tentar novamente" seguro: quando a rede cai DEPOIS de o
     * servidor já ter mandado, a tela vê erro e o operador tenta de novo — sem
     * isto, o contato receberia a mesma mensagem duas vezes. Também cobre o
     * clique duplo e o retry automático do navegador.
     */
    const findByClientId = async () =>
      clientId
        ? (
            await supabase
              .from("chat_messages")
              .select()
              .eq("conversation_id", id)
              .eq("metadata->>clientId", clientId)
              .limit(1)
              .maybeSingle()
          ).data
        : null;
    const existing = await findByClientId();

    // Já saiu (ou está saindo): devolve a mesma linha, sem reenviar nada.
    if (existing && existing.delivery_status !== "failed") {
      return NextResponse.json({ message: existing });
    }

    // Assinatura do operador (apelido, ou 1º nome; nada se ele desmarcou).
    // Grava-se o MESMO texto que vai ao contato — o histórico do CRM reflete
    // exatamente o que foi enviado. Notas internas nunca são assinadas.
    //
    // No reenvio o texto vem da LINHA, não do corpo: assinar de novo o que já
    // está assinado poria a assinatura duas vezes na mensagem do contato.
    const outboundContent =
      existing?.content ?? signMessage(content, resolveSignature(viewer));
    const quotedId = existing ? existing.quoted_message_id : quotedMessageId ?? null;

    // Responder: o provedor cita pelo id DELE (`external_id`), não pelo nosso.
    const quote = await resolveQuotedExternalId(supabase, id, quotedId);
    if (!quote.ok) {
      return NextResponse.json({ error: "quoted message not found" }, { status: 400 });
    }
    const replyExternalId = quote.externalId;
    const linkPreview = buildMessageLinkPreview(outboundContent);

    // 1) Insere a mensagem como `pending` — o id vira o track_id do envio.
    //    No reenvio a linha já existe e só volta para `pending`: os ticks são
    //    monótonos e `sent` não sobrescreve `failed` (ver `overridableFrom`),
    //    então sem esse passo um reenvio bem-sucedido ficaria marcado como erro.
    //    O filtro por `failed` faz só UM de dois reenvios simultâneos virar a
    //    linha; o outro não acha nada e devolve a mesma mensagem, sem mandar.
    const { data: msg, error: msgErr } = existing
      ? await supabase
          .from("chat_messages")
          .update({ delivery_status: "pending" })
          .eq("id", existing.id)
          .eq("delivery_status", "failed")
          .select()
          .maybeSingle()
      : await supabase
          .from("chat_messages")
          .insert({
            conversation_id: id,
            direction: "outbound",
            sender_type: "agent",
            type: "text",
            content: outboundContent,
            quoted_message_id: quotedId,
            metadata: {
              ...(clientId ? { clientId } : {}),
              ...(linkPreview ? { linkPreview } : {}),
            },
            delivery_status: "pending",
            sent_by_user_id: viewer.id,
            created_at: now,
          })
          .select()
          .single();

    // Clique duplo simultâneo: os dois passaram pelo SELECT acima, e o índice
    // único de `clientId` barrou o segundo INSERT (23505). Quem envia é a
    // primeira requisição; esta devolve a mesma linha.
    const lostRace = existing ? !msgErr && !msg : msgErr?.code === "23505";
    if (lostRace) {
      const winner = await findByClientId();
      if (winner) return NextResponse.json({ message: winner });
    }
    if (msgErr || !msg) throw msgErr ?? new Error("insert failed");

    // 2) Envia pelo provedor.
    try {
      const result = await sendUazapiText(
        integration.apiUrl,
        integration.token,
        phone,
        outboundContent,
        { trackId: msg.id, replyId: replyExternalId }
      );
      // external_id/metadata: sempre (p/ casar status e deduplicar o echo).
      const providerPreview = result.linkPreview ?? linkPreview;
      const { error: idErr } = await supabase
        .from("chat_messages")
        .update({
          external_id: result.messageid,
          metadata: {
            // O `clientId` sobrevive à sobrescrita do metadata: é ele que liga
            // esta linha à bolha da tela e ao reenvio.
            ...(clientId ? { clientId } : {}),
            uazapiId: result.id,
            ...(providerPreview ? { linkPreview: providerPreview } : {}),
          },
        })
        .eq("id", msg.id);
      if (idErr) console.error("[send] gravar external_id falhou:", idErr, msg.id);
      // delivery_status → 'sent' de forma MONÓTONA: não regride um delivered/read
      // que um messages_update pode ter gravado durante o await do envio.
      const { error: stErr } = await supabase
        .from("chat_messages")
        .update({ delivery_status: "sent" })
        .eq("id", msg.id)
        .in("delivery_status", overridableFrom("sent"));
      if (stErr) console.error("[send] update delivery_status falhou:", stErr, msg.id);
    } catch (sendErr) {
      await supabase
        .from("chat_messages")
        .update({ delivery_status: "failed" })
        .eq("id", msg.id)
        .in("delivery_status", overridableFrom("failed"));
      console.error("[send] provider send failed:", sendErr);
      return NextResponse.json(
        { error: "Falha ao enviar pela API do WhatsApp." },
        { status: 502 }
      );
    }

    const { data: finalMsg } = await supabase
      .from("chat_messages")
      .select()
      .eq("id", msg.id)
      .single();

    return NextResponse.json({ message: finalMsg ?? msg });
  } catch (err) {
    console.error("[POST /api/chat/conversations/[id]/send]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
