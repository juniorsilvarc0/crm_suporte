import type { SupabaseClient } from "@supabase/supabase-js";

import { assertSafeUrl } from "@/lib/security/ssrf-guard";
import { CHAT_MEDIA_BUCKET } from "@/lib/storage/chat-media";
import type { Database } from "@/lib/supabase/types";

// Transcrição de um áudio do chat pela OpenAI. A tela (o "Transcrever" do
// analista, POST /api/chat/transcribe) e a API v1 (a IA de triagem) passam por
// aqui. O texto fica em chat_messages.metadata.transcription: a 2ª vez sai de
// lá, sem nova chamada (nem cobrança) da OpenAI.
//
// Quem chama lê a chave e o modelo do cofre ANTES (getOpenAiTranscriptionConfig)
// e só chega aqui com a chave: sem ela, nem a mensagem é lida.

export type TranscriptionConfig = { apiKey: string; model: string };

export type ChatTranscriptionResult =
  | { ok: true; transcription: string; cached: boolean }
  | { ok: false; reason: "not_found" | "audio_unavailable" | "provider_failed" };

type Db = SupabaseClient<Database>;

type MsgRow = {
  media_url: string | null;
  media_mime_type: string | null;
  media_bucket: string | null;
  media_key: string | null;
};

/**
 * Transcreve o áudio da mensagem (ou devolve a transcrição já guardada). Os
 * bytes vêm do bucket privado `chat-media` (service role), de um data: URI ou,
 * se a re-hospedagem falhou, da URL do provedor, com o guard de SSRF.
 */
export async function transcribeChatMessage(
  supabase: Db,
  messageId: string,
  config: TranscriptionConfig
): Promise<ChatTranscriptionResult> {
  const { data: msg, error: msgErr } = await supabase
    .from("chat_messages")
    .select(
      "id, conversation_id, external_id, media_url, media_mime_type, media_bucket, media_key, metadata"
    )
    .eq("id", messageId)
    .single();

  if (msgErr || !msg) return { ok: false, reason: "not_found" };

  // Return cached transcription if present
  const cached = (msg.metadata as { transcription?: string })?.transcription;
  if (cached) return { ok: true, transcription: cached, cached: true };

  const bytes = await resolveAudioBytes(supabase, msg);
  if (!bytes) return { ok: false, reason: "audio_unavailable" };

  // Transcrição OpenAI, com a chave e o modelo que quem chama leu do cofre.
  const form = new FormData();
  const mime = msg.media_mime_type || "audio/ogg";
  const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : "ogg";
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `audio.${ext}`);
  form.append("model", config.model);
  form.append("language", "pt");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    console.error("[transcribe] whisper error", body);
    return { ok: false, reason: "provider_failed" };
  }

  const { text } = (await res.json()) as { text: string };

  // Persist on the message metadata
  await supabase
    .from("chat_messages")
    .update({
      metadata: { ...(msg.metadata as object), transcription: text },
    })
    .eq("id", messageId);

  return { ok: true, transcription: text, cached: false };
}

async function resolveAudioBytes(supabase: Db, msg: MsgRow): Promise<Buffer | null> {
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
