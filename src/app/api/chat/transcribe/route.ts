import { NextResponse } from "next/server";
import { transcribeChatMessage } from "@/features/chat/lib/transcribe-message";
import {
  getOpenAiTranscriptionConfig,
  RuntimeEnvironmentUnavailableError,
} from "@/features/settings/lib/get-runtime-environment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";

type Body = { messageId: string };

/**
 * Transcribes an audio message using OpenAI Whisper.
 * Works across providers by resolving the audio bytes from:
 *  - o bucket privado `chat-media`, baixado pela service role
 *  - a data: URI stored in media_url
 *  - a URL do provedor, quando a re-hospedagem falhou (com guard de SSRF)
 * A transcrição em si mora em features/chat/lib/transcribe-message (a API v1
 * usa a mesma, para a IA de triagem).
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
    const result = await transcribeChatMessage(supabase, messageId, { apiKey, model });

    if (result.ok) return NextResponse.json({ transcription: result.transcription });
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (result.reason === "audio_unavailable") {
      return NextResponse.json(
        { error: "Não foi possível obter o áudio para transcrição." },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: "Falha na transcrição." }, { status: 502 });
  } catch (err) {
    console.error("[POST transcribe]", err);
    if (err instanceof RuntimeEnvironmentUnavailableError) {
      return NextResponse.json({ error: "Transcrição indisponível no momento." }, { status: 503 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
