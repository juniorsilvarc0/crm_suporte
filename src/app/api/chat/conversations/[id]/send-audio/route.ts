import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEvolutionAudio } from "@/features/chat/lib/senders/evolution";
import { sendUazapiAudio } from "@/features/chat/lib/senders/uazapi";
import { putMedia } from "@/lib/storage/put-media";
import { resolveQuotedExternalId } from "@/features/chat/queries/resolve-quoted";
import { sendMetaAudio } from "@/features/chat/lib/senders/meta";
import { overridableFrom } from "@/features/chat/lib/delivery-status";
import { resolveConversationChannelAddress } from "@/features/chat/lib/conversation-channel-address";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { audioBase64, mimeType, seconds, quotedMessageId } = (await request.json()) as {
      quotedMessageId?: string | null;
      audioBase64: string;
      mimeType?: string;
      seconds?: number;
    };

    if (!audioBase64) {
      return NextResponse.json({ error: "audio required" }, { status: 400 });
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

    const phone = resolveConversationChannelAddress(conv);
    if (!phone) {
      return NextResponse.json({ error: "No phone on conversation" }, { status: 400 });
    }

    const { data: integration } = conv.integration_id
      ? await supabase
          .from("chat_integrations")
          .select("provider, config")
          .eq("id", conv.integration_id)
          .single()
      : { data: null };

    if (!integration) {
      return NextResponse.json({ error: "No integration" }, { status: 400 });
    }

    const intConfig = integration.config as Record<string, string>;
    const mime = mimeType || "audio/webm";
    const bytes = Buffer.from(audioBase64, "base64");

    // 1) Guarda para playback na nossa UI (o envio ao provedor usa base64).
    //    `putMedia` reencoda o áudio para voz e escolhe R2 ou Supabase.
    const stored = await putMedia({ supabase, folder: "chat", body: bytes, mime });
    const publicUrl = stored?.url ?? null;

    // Citação: o provedor cita pelo id DELE (`external_id`), não pelo nosso.
    const quote = await resolveQuotedExternalId(supabase, id, quotedMessageId);
    if (!quote.ok) {
      return NextResponse.json({ error: "quoted message not found" }, { status: 400 });
    }
    const replyExternalId = quote.externalId;

    // 2) Insere como pending (id = track_id do envio).
    const now = new Date().toISOString();
    const { data: msg, error: msgErr } = await supabase
      .from("chat_messages")
      .insert({
        quoted_message_id: quotedMessageId ?? null,
        conversation_id: id,
        direction: "outbound",
        type: "audio",
        content: null,
        media_url: publicUrl,
        media_mime_type: mime,
        delivery_status: "pending",
        metadata: { seconds: seconds ?? 0 },
        created_at: now,
      })
      .select()
      .single();
    if (msgErr || !msg) throw msgErr ?? new Error("insert failed");

    // 3) Envia pelo provedor.
    try {
      if (integration.provider === "uazapi") {
        const { apiUrl, token } = intConfig;
        const result = await sendUazapiAudio(apiUrl, token, phone, audioBase64, msg.id, replyExternalId);
        const { error: idErr } = await supabase
          .from("chat_messages")
          .update({
            external_id: result.messageid,
            metadata: { seconds: seconds ?? 0, uazapiId: result.id },
          })
          .eq("id", msg.id);
        if (idErr) console.error("[send-audio] gravar external_id falhou:", idErr, msg.id);
      } else if (integration.provider === "evolution") {
        const { apiUrl, apiKey, instance } = intConfig;
        await sendEvolutionAudio(apiUrl, apiKey, instance, phone, audioBase64);
      } else if (integration.provider === "meta") {
        const { phoneNumberId, accessToken } = intConfig;
        const blob = new Blob([new Uint8Array(bytes)], { type: mime });
        await sendMetaAudio(phoneNumberId, accessToken, phone, blob);
      }
      // delivery_status → 'sent' monótono (não regride delivered/read de corrida).
      const { error: stErr } = await supabase
        .from("chat_messages")
        .update({ delivery_status: "sent" })
        .eq("id", msg.id)
        .in("delivery_status", overridableFrom("sent"));
      if (stErr) console.error("[send-audio] update delivery_status falhou:", stErr, msg.id);
    } catch (sendErr) {
      await supabase
        .from("chat_messages")
        .update({ delivery_status: "failed" })
        .eq("id", msg.id)
        .in("delivery_status", overridableFrom("failed"));
      console.error("[send-audio] provider send failed:", sendErr);
      return NextResponse.json(
        { error: "Falha ao enviar o áudio pela API do WhatsApp." },
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
    console.error("[POST send-audio]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
