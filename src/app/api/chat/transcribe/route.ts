import { NextResponse } from "next/server";
import {
  getOpenAiTranscriptionConfig,
  RuntimeEnvironmentUnavailableError,
} from "@/features/settings/lib/get-runtime-environment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { assertSafeUrl } from "@/features/chat/lib/connection/ssrf-guard";
import { CHAT_MEDIA_BUCKET } from "@/lib/storage/chat-media";

type Body = { messageId: string };

/**
 * Transcribes an audio message using OpenAI Whisper.
 * Works across providers by resolving the audio bytes from:
 *  - o bucket privado `chat-media`, baixado pela service role
 *  - a data: URI stored in media_url
 *  - a URL do provedor, quando a re-hospedagem falhou (com guard de SSRF)
 */
export async function POST(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  try {
    const { messageId } = (await request.json()) as Body;
    if (!messageId) {
      return NextResponse.json({ error: "messageId required" }, { status: 400 });
    }

    const { apiKey, model } = await getOpenAiTranscriptionConfig();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Transcrição indisponível: cadastre OPENAI_API_KEY no cofre (Configurações)." },
        { status: 503 }
      );
    }

    const supabase = createSupabaseAdminClient();

    const { data: msg, error: msgErr } = await supabase
      .from("chat_messages")
      .select(
        "id, conversation_id, external_id, media_url, media_mime_type, media_bucket, media_key, metadata"
      )
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
    if (err instanceof RuntimeEnvironmentUnavailableError) {
      return NextResponse.json({ error: "Transcrição indisponível no momento." }, { status: 503 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

type MsgRow = {
  media_url: string | null;
  media_mime_type: string | null;
  media_bucket: string | null;
  media_key: string | null;
};

async function resolveAudioBytes(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  msg: MsgRow
): Promise<Buffer | null> {
  // 0. Bucket privado: `media_url` é a rota do app, que exige sessão.
  if (msg.media_bucket === CHAT_MEDIA_BUCKET && msg.media_key) {
    const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).download(msg.media_key);
    if (error || !data) {
      console.error("[transcribe] download do bucket falhou:", error?.message);
      return null;
    }
    return Buffer.from(await data.arrayBuffer());
  }

  const url = msg.media_url;

  // 1. data: URI
  if (url?.startsWith("data:")) {
    const base64 = url.split(",")[1] ?? "";
    return Buffer.from(base64, "base64");
  }

  // 2. URL do provedor. Ela veio do payload do webhook: sem o guard, a rota
  //    buscaria qualquer endereço da rede interna que chegasse ali.
  if (url && !url.endsWith(".enc")) {
    try {
      const r = await fetch(assertSafeUrl(url), {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch {
      /* cai no retorno nulo abaixo */
    }
  }


  return null;
}
