import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendUazapiMedia, type UazapiMediaType } from "@/features/chat/lib/senders/uazapi";
import { putMedia } from "@/lib/storage/put-media";
import { resolveQuotedExternalId } from "@/features/chat/queries/resolve-quoted";
import { compressVideo } from "@/features/chat/lib/media/compress-video";
import { overridableFrom } from "@/features/chat/lib/delivery-status";
import type { MessageType } from "@/features/chat/types";
import { resolveConversationChannelAddress } from "@/features/chat/lib/conversation-channel-address";

// Node runtime obrigatório: usa child_process (ffmpeg) + fs.
export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

// Limite de upload. O WhatsApp aceita ~16MB de mídia (vídeo/imagem/áudio) e
// ~100MB de documento; deixamos 64MB de folga p/ o upload e a uazapi decide.
const MAX_BYTES = 64 * 1024 * 1024;

// Classifica o anexo pelo mimetype: imagem/vídeo viram mídia; o resto (pdf,
// docx, xlsx, etc.) vira documento.
function classify(mime: string): { uazapiType: UazapiMediaType; msgType: MessageType } {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return { uazapiType: "image", msgType: "image" };
  if (m.startsWith("video/")) return { uazapiType: "video", msgType: "video" };
  return { uazapiType: "document", msgType: "document" };
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;

    // multipart/form-data: o arquivo vai como binário puro (sem inflar 33% em
    // base64) e é streamado — essencial para vídeos/arquivos grandes.
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    const fileName = file.name?.trim() || "arquivo";
    // Vem no form porque o corpo é multipart — não há JSON onde pendurar.
    const quotedMessageId = (form.get("quotedMessageId") as string | null) || null;
    // Legenda do anexo, escrita na tela de envio.
    const caption = ((form.get("caption") as string | null) || "").trim();

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
    if (integration.provider !== "uazapi") {
      return NextResponse.json(
        { error: "Envio de anexo disponível apenas para uazapi." },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Arquivo muito grande (máx. 64MB)." }, { status: 413 });
    }

    let bytes: Buffer = Buffer.from(await file.arrayBuffer());
    let mime = file.type || "application/octet-stream";

    const { uazapiType, msgType } = classify(mime);

    // Vídeo grande: comprime como o WhatsApp (720p, H.264/AAC) p/ caber no limite
    // do WhatsApp (~16MB). Se o ffmpeg falhar, segue com o original.
    if (uazapiType === "video" && bytes.length > 10 * 1024 * 1024) {
      try {
        const compressed = await compressVideo(bytes);
        if (compressed.length > 0 && compressed.length < bytes.length) {
          bytes = compressed;
          // A extensão do objeto sai do `mime` (ver `buildMediaKey`), então
          // não há mais um nome de arquivo a corrigir aqui — o nome ORIGINAL
          // segue indo para o provedor e para o `metadata.fileName`.
          mime = "video/mp4";
          console.info(
            `[send-file] vídeo comprimido: ${file.size} -> ${bytes.length} bytes`
          );
        }
      } catch (e) {
        console.error("[send-file] compressão falhou, enviando original:", e);
      }
    }

    // 1) Guarda (URL pública — a uazapi baixa esta URL no /send/media).
    //    Vídeo já veio comprimido acima; `putMedia` cuida de imagem e áudio e
    //    escolhe entre R2 e Supabase.
    const stored = await putMedia({
      supabase,
      folder: "chat",
      body: Buffer.from(bytes),
      mime,
    });
    if (!stored) {
      return NextResponse.json({ error: "Falha ao subir o arquivo." }, { status: 500 });
    }
    const publicUrl = stored.url;

    // ⚠️ A miniatura e as dimensões são GERADAS e SUBIDAS pelo `putMedia`. Sem
    // gravá-las aqui, a bolha ignora o arquivo pequeno que acabou de ser pago e
    // serve o cheio — e a foto volta a remedir a linha ao carregar.
    const mediaMeta: Record<string, string | number> = {
      ...(msgType === "document" ? { fileName } : {}),
      ...(stored.thumbUrl ? { thumbUrl: stored.thumbUrl } : {}),
      ...(stored.width && stored.height
        ? { mediaWidth: stored.width, mediaHeight: stored.height }
        : {}),
    };

    // Citação: o provedor cita pelo id DELE (`external_id`), não pelo nosso.
    const quote = await resolveQuotedExternalId(supabase, id, quotedMessageId);
    if (!quote.ok) {
      return NextResponse.json({ error: "quoted message not found" }, { status: 400 });
    }

    // 2) Insere pending (documento guarda o nome do arquivo em content).
    const now = new Date().toISOString();
    const { data: msg, error: msgErr } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: id,
        direction: "outbound",
        type: msgType,
        // `content` é a legenda. O nome do arquivo vai para o metadata: se a
        // legenda ocupasse o `content`, a bolha do documento perderia o nome e
        // passaria a rotular o anexo com o texto da legenda.
        content: caption || (msgType === "document" ? fileName : null),
        ...(Object.keys(mediaMeta).length > 0 ? { metadata: mediaMeta } : {}),
        media_url: publicUrl,
        media_mime_type: mime,
        quoted_message_id: quotedMessageId,
        delivery_status: "pending",
        created_at: now,
      })
      .select()
      .single();
    if (msgErr || !msg) throw msgErr ?? new Error("insert failed");

    // 3) Envia via uazapi (file = URL pública).
    try {
      const { apiUrl, token } = integration.config as Record<string, string>;
      const result = await sendUazapiMedia(apiUrl, token, phone, {
        type: uazapiType,
        file: publicUrl,
        trackId: msg.id,
        replyId: quote.externalId,
        ...(caption ? { text: caption } : {}),
        ...(uazapiType === "document" ? { docName: fileName } : {}),
      });
      const { error: idErr } = await supabase
        .from("chat_messages")
        // MERGE, não substituição: este `update` apagava o metadata inteiro —
        // levava junto o `fileName` do documento e, agora, a miniatura.
        .update({
          external_id: result.messageid,
          metadata: { ...mediaMeta, uazapiId: result.id },
        })
        .eq("id", msg.id);
      if (idErr) console.error("[send-file] gravar external_id falhou:", idErr, msg.id);

      const { error: stErr } = await supabase
        .from("chat_messages")
        .update({ delivery_status: "sent" })
        .eq("id", msg.id)
        .in("delivery_status", overridableFrom("sent"));
      if (stErr) console.error("[send-file] update delivery_status falhou:", stErr, msg.id);
    } catch (sendErr) {
      await supabase
        .from("chat_messages")
        .update({ delivery_status: "failed" })
        .eq("id", msg.id)
        .in("delivery_status", overridableFrom("failed"));
      console.error("[send-file] provider send failed:", sendErr);
      return NextResponse.json(
        { error: "Falha ao enviar o anexo pela API do WhatsApp." },
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
    console.error("[POST send-file]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
