import { NextResponse } from "next/server";
import { getOpenAiTranscriptionConfig } from "@/features/settings/lib/get-runtime-environment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = { messageId: string };

/**
 * Transcribes an audio message using OpenAI Whisper.
 * Works across providers by resolving the audio bytes from:
 *  - a data: URI stored in media_url
 *  - a public/accessible media URL (Meta, UazAPI, our own storage)
 *  - Evolution's getBase64FromMediaMessage endpoint (encrypted .enc URLs)
 */
export async function POST(request: Request) {
  try {
    const { messageId } = (await request.json()) as Body;
    if (!messageId) {
      return NextResponse.json({ error: "messageId required" }, { status: 400 });
    }

    const { apiKey, model } = await getOpenAiTranscriptionConfig();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Transcrição indisponível: configure OPENAI_API_KEY." },
        { status: 503 }
      );
    }

    const supabase = createSupabaseAdminClient();

    const { data: msg, error: msgErr } = await supabase
      .from("chat_messages")
      .select("id, conversation_id, external_id, media_url, media_mime_type, metadata")
      .eq("id", messageId)
      .single();

    if (msgErr || !msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Return cached transcription if present
    const cached = (msg.metadata as { transcription?: string })?.transcription;
    if (cached) return NextResponse.json({ transcription: cached });

    const bytes = await resolveAudioBytes(supabase, msg);
    if (!bytes) {
      return NextResponse.json(
        { error: "Não foi possível obter o áudio para transcrição." },
        { status: 422 }
      );
    }

    // Transcrição OpenAI. Chave e modelo podem vir do cofre; o ambiente da VPS
    // continua como fallback para manter compatibilidade.
    const form = new FormData();
    const mime = msg.media_mime_type || "audio/ogg";
    const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : "ogg";
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `audio.${ext}`);
    form.append("model", model);
    form.append("language", "pt");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      console.error("[transcribe] whisper error", body);
      return NextResponse.json({ error: "Falha na transcrição." }, { status: 502 });
    }

    const { text } = (await res.json()) as { text: string };

    // Persist on the message metadata
    await supabase
      .from("chat_messages")
      .update({
        metadata: { ...(msg.metadata as object), transcription: text },
      })
      .eq("id", messageId);

    return NextResponse.json({ transcription: text });
  } catch (err) {
    console.error("[POST transcribe]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

type MsgRow = {
  conversation_id: string;
  external_id: string | null;
  media_url: string | null;
  media_mime_type: string | null;
};

async function resolveAudioBytes(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  msg: MsgRow
): Promise<Buffer | null> {
  const url = msg.media_url;

  // 1. data: URI
  if (url?.startsWith("data:")) {
    const base64 = url.split(",")[1] ?? "";
    return Buffer.from(base64, "base64");
  }

  // 2. Directly fetchable URL (our storage, Meta, UazAPI)
  if (url && !url.endsWith(".enc")) {
    try {
      const r = await fetch(url);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {
      /* fall through to provider-specific resolution */
    }
  }

  // 3. Evolution: decrypt via getBase64FromMediaMessage
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("integration_id")
    .eq("id", msg.conversation_id)
    .single();

  if (conv?.integration_id) {
    const { data: integration } = await supabase
      .from("chat_integrations")
      .select("provider, config")
      .eq("id", conv.integration_id)
      .single();

    if (integration?.provider === "evolution" && msg.external_id) {
      const cfg = integration.config as Record<string, string>;
      try {
        const r = await fetch(
          `${cfg.apiUrl}/chat/getBase64FromMediaMessage/${cfg.instance}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: cfg.apiKey,
            },
            body: JSON.stringify({
              message: { key: { id: msg.external_id } },
              convertToMp4: false,
            }),
          }
        );
        if (r.ok) {
          const json = (await r.json()) as { base64?: string };
          if (json.base64) return Buffer.from(json.base64, "base64");
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}
