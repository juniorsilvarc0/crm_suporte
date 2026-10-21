import { transcribeChatMessage } from "@/features/chat/lib/transcribe-message";
import { getOpenAiTranscriptionConfig } from "@/features/settings/lib/get-runtime-environment";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transcreve um áudio da conversa, para a IA de triagem entender o que o
 * cliente falou. É a mesma transcrição do "Transcrever" do analista (OpenAI,
 * com a chave e o modelo do cofre do CRM): o texto fica guardado na própria
 * mensagem, então a 2ª chamada sai de lá, sem nova cobrança, e o analista vê o
 * mesmo texto no chat. Repetir é seguro: sem Idempotency-Key.
 */
export const POST = withApi<{ id: string; message_id: string }>(
  { route: "/api/v1/conversations/[id]/messages/[message_id]/transcription", scopes: ["conversations:read"] },
  async ({ params, requestId, supabase }) => {
    if (!isUuid(params.id) || !isUuid(params.message_id)) {
      return notFound(requestId, "Mensagem não encontrada.");
    }

    const { data: message, error } = await supabase
      .from("chat_messages")
      .select("id, type, is_deleted")
      .eq("id", params.message_id)
      .eq("conversation_id", params.id)
      .maybeSingle();
    if (error) {
      console.error(`[api/v1] ${requestId} transcription message`, error.code, error.message);
      return unavailable(requestId, "a mensagem");
    }
    if (!message) return notFound(requestId, "Mensagem não encontrada.");
    if (message.type !== "audio") return apiError(requestId, 422, "not_audio", "A mensagem não é um áudio.");
    if (message.is_deleted) return apiError(requestId, 422, "message_deleted", "A mensagem foi apagada.");

    let config: Awaited<ReturnType<typeof getOpenAiTranscriptionConfig>>;
    try {
      config = await getOpenAiTranscriptionConfig();
    } catch (cause) {
      console.error(`[api/v1] ${requestId} transcription config`, cause);
      return unavailable(requestId, "a configuração da transcrição");
    }
    if (!config.apiKey) {
      return apiError(
        requestId,
        503,
        "transcription_unavailable",
        "Transcrição indisponível: o CRM não tem a chave da OpenAI (OPENAI_API_KEY) no cofre."
      );
    }

    const result = await transcribeChatMessage(supabase, message.id, {
      apiKey: config.apiKey,
      model: config.model,
    });
    if (result.ok) {
      return apiOk({ message_id: message.id, transcription: result.transcription, cached: result.cached });
    }
    if (result.reason === "not_found") return notFound(requestId, "Mensagem não encontrada.");
    if (result.reason === "audio_unavailable") {
      return apiError(requestId, 422, "audio_unavailable", "Não foi possível obter o arquivo do áudio.");
    }
    return apiError(requestId, 502, "transcription_failed", "A transcrição falhou. Tente de novo.");
  }
);
