import type { SupabaseClient } from "@supabase/supabase-js";

import { isConversationStatus } from "@/features/chat/lib/conversation-status";
import { sendOutboundText } from "@/features/chat/lib/send-outbound";
import { conversationExists, getApiConversationMessages } from "@/features/chat/queries/get-api-conversation";
import {
  MESSAGES_PER_CONVERSATION_PER_HOUR,
  MESSAGES_PER_CONVERSATION_PER_MIN,
  messageSendBodySchema,
  toApiConversationMessage,
} from "@/lib/api/v1/conversations";
import { messageListQuerySchema, searchParamsOf } from "@/lib/api/v1/cursor";
import { apiError } from "@/lib/api/v1/errors";
import { IDEMPOTENCY_HEADER, sha256Hex } from "@/lib/api/v1/idempotency";
import { apiOk, apiPage, invalidInput, notFound, unavailable } from "@/lib/api/v1/responses";
import { hasScope } from "@/lib/api/v1/scopes";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";
import { rateLimit } from "@/lib/security/rate-limit";
import type { Database } from "@/lib/supabase/types";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * As mensagens da conversa, da MAIS NOVA para a mais antiga. A nota interna
 * (`type: note`) é do time e só entra com `comments:read`, como na timeline do
 * ticket: o preset da IA não tem esse escopo. Sem mídia por URL: só o tipo.
 */
export const GET = withApi<{ id: string }>(
  { route: "/api/v1/conversations/[id]/messages", scopes: ["conversations:read"] },
  async ({ request, params, requestId, supabase, token }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Conversa não encontrada.");

    const parsed = messageListQuerySchema.safeParse(searchParamsOf(request));
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    try {
      // Página vazia não diz se a conversa existe: a leitura dela separa o 404.
      const [exists, page] = await Promise.all([
        conversationExists(supabase, params.id),
        getApiConversationMessages(supabase, params.id, {
          before: parsed.data.cursor,
          limit: parsed.data.limit,
          notes: hasScope(token.scopes, "comments:read"),
        }),
      ]);
      if (!exists) return notFound(requestId, "Conversa não encontrada.");
      return apiPage(page.items, page.nextCursor);
    } catch (error) {
      console.error(`[api/v1] ${requestId} messages`, error);
      return unavailable(requestId, "as mensagens");
    }
  }
);

/**
 * A chave que impede a MESMA mensagem de sair duas vezes, gravada na linha
 * (`metadata.clientId`, índice único por conversa). Sai da Idempotency-Key e do
 * token: o Idempotency-Key guarda a resposta por 24 h, e esta 2ª camada cobre o
 * servidor que cai entre enviar e responder. Com o token no hash, a chave de um
 * integrador nunca casa com a de outro nem com a da tela.
 */
function clientIdFor(tokenId: string, idempotencyKey: string): string {
  return `k${sha256Hex(`${tokenId}:${idempotencyKey}`).slice(0, 40)}`;
}

type SendGate = {
  requestId: string;
  supabase: SupabaseClient<Database>;
  tokenId: string;
  conversationId: string;
  isAi: boolean;
};

/**
 * A última conferência, feita pelo send-outbound só quando a mensagem VAI ao
 * WhatsApp: repetir uma chave que já saiu não gasta o teto nem esbarra no dono
 * da conversa. Devolve a recusa, ou `null` para seguir.
 */
async function refuseSend({ requestId, supabase, tokenId, conversationId, isAi }: SendGate): Promise<Response | null> {
  if (isAi) {
    // Lido AGORA, e não junto com a conversa: o analista pode ter assumido
    // entre a leitura e o envio.
    const { data, error } = await supabase
      .from("chat_conversations")
      .select("status")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) {
      console.error(`[api/v1] ${requestId} send: status`, error.message);
      return unavailable(requestId, "a conversa");
    }
    if (!data) return notFound(requestId, "Conversa não encontrada.");
    if (data.status !== "bot") {
      return apiError(
        requestId,
        409,
        "conversation_not_owned_by_ai",
        "A conversa não está com a IA.",
        isConversationStatus(data.status) ? { current: data.status } : {}
      );
    }
  }

  // Dois tetos por conversa, contra o agente em laço: o do minuto segura a
  // rajada, o da hora segura o laço que dura (duas automações conversando). O
  // que o do minuto barra não chega a contar no da hora.
  const minute = rateLimit(`api-send:${tokenId}:${conversationId}`, MESSAGES_PER_CONVERSATION_PER_MIN, 60_000);
  const limit = minute.ok
    ? rateLimit(`api-send-h:${tokenId}:${conversationId}`, MESSAGES_PER_CONVERSATION_PER_HOUR, 3_600_000)
    : minute;
  if (limit.ok) return null;
  return apiError(
    requestId,
    429,
    "rate_limited",
    "Muitas mensagens para esta conversa. Tente de novo mais tarde.",
    {},
    { "Retry-After": String(limit.retryAfter) }
  );
}

/**
 * Envia um TEXTO ao cliente pelo WhatsApp, pelo mesmo caminho da tela
 * (send-outbound.ts). A mensagem fica gravada com o token como autor e o
 * remetente do tipo dele: `ai` para a IA, `system` para uma integração. O CRM
 * não assina o texto (D12).
 *
 * A IA só fala na conversa que é dela: fora de `bot`, 409
 * `conversation_not_owned_by_ai`. Uma integração (`system`) não tem essa trava.
 *
 * O envio é NO MÁXIMO UMA VEZ por Idempotency-Key. 502 = a mensagem não saiu, e
 * a mesma chave tenta de novo. 504 = o WhatsApp não confirmou: pode ter saído,
 * então a mesma chave não manda de novo enquanto a linha estiver `pending`; só
 * responde o que ela virou.
 */
export const POST = withApi<{ id: string }>(
  { route: "/api/v1/conversations/[id]/messages", scopes: ["messages:send"], idempotency: "required" },
  async ({ request, params, requestId, supabase, token }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Conversa não encontrada.");

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = messageSendBodySchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    const { data: conversation, error } = await supabase
      .from("chat_conversations")
      .select("id, external_id, contact_phone, integration_id")
      .eq("id", params.id)
      .maybeSingle();
    if (error) {
      console.error(`[api/v1] ${requestId} send: conversa`, error.message);
      return unavailable(requestId, "a conversa");
    }
    if (!conversation) return notFound(requestId, "Conversa não encontrada.");

    const isAi = token.actorType === "ai";
    // A chave já passou pelo formato no withApi (rota idempotente).
    const idempotencyKey = request.headers.get(IDEMPOTENCY_HEADER) ?? "";
    const result = await sendOutboundText<Response>(supabase, {
      conversation,
      content: parsed.data.text,
      finalize: (text) => text,
      clientId: clientIdFor(token.id, idempotencyKey),
      quotedMessageId: null,
      author: { kind: "token", tokenId: token.id, senderType: isAi ? "ai" : "system" },
      now: new Date().toISOString(),
      beforeSend: () =>
        refuseSend({ requestId, supabase, tokenId: token.id, conversationId: conversation.id, isAi }),
    });

    if (result.ok) {
      const message = toApiConversationMessage(result.message);
      if (!message) throw new Error(`chat_messages: linha inesperada ${result.message.id}`);
      // 200 = a mesma chave já tinha enviado esta mensagem (a 2ª camada pegou).
      return apiOk(message, { status: result.outcome === "sent" ? 201 : 200 });
    }

    switch (result.reason) {
      case "refused":
        return result.refusal;
      case "provider_failed":
        return apiError(
          requestId,
          502,
          "whatsapp_unavailable",
          "A mensagem não saiu: o WhatsApp recusou o envio ou não foi alcançado. Repetir com a mesma Idempotency-Key tenta de novo, sem duplicar.",
          {},
          { "Retry-After": "5" }
        );
      case "outcome_unknown":
        return apiError(
          requestId,
          504,
          "delivery_unknown",
          "O WhatsApp não confirmou o envio: a mensagem pode ter saído. Não envie de novo com outra chave; repita este pedido com a mesma Idempotency-Key para saber o desfecho.",
          {},
          { "Retry-After": "10" }
        );
      case "content_mismatch":
      case "not_author":
        return apiError(
          requestId,
          422,
          "idempotency_key_reused",
          "Esta Idempotency-Key já foi usada nesta conversa para outra mensagem."
        );
      case "integration_unreadable":
        console.error(`[api/v1] ${requestId} send: integração`, result.error);
        return unavailable(requestId, "a integração do WhatsApp");
      // Sem endereço do canal ou sem integração (WhatsApp nunca conectado ou
      // excluído): não há por onde enviar. `quoted_not_found` não acontece: a
      // v1 não cita.
      case "no_phone":
      case "no_integration":
      case "quoted_not_found":
        return apiError(
          requestId,
          409,
          "channel_unavailable",
          "A conversa não tem um canal de WhatsApp ativo para envio."
        );
    }
  }
);
