import type { SupabaseClient } from "@supabase/supabase-js";

import { getIntegrationCredentials } from "@/features/chat/lib/connection/integration";
import { resolveConversationChannelAddress } from "@/features/chat/lib/conversation-channel-address";
import { overridableFrom } from "@/features/chat/lib/delivery-status";
import { buildMessageLinkPreview } from "@/features/chat/lib/message-content";
import { sendUazapiText, uazapiSendDefinitelyFailed } from "@/features/chat/lib/senders/uazapi";
import { resolveQuotedExternalId } from "@/features/chat/queries/resolve-quoted";
import type { Database } from "@/lib/supabase/types";

// O envio de TEXTO ao WhatsApp, extraído da rota de sessão (.../send) para a
// API v1 usar o mesmo caminho: resolve a integração, grava a mensagem
// `pending`, envia pelo provedor e carimba o resultado. Quem chama já
// autenticou e já leu a conversa.
//
// Muda QUEM assina a linha e, com isso, o que se faz quando o provedor não
// confirma o envio. O analista vê a conversa e decide se reenvia: para ele toda
// falha vira `failed`, como sempre foi. O token é um programa que repete
// sozinho: para ele o envio é NO MÁXIMO UMA VEZ. Só vira `failed` (e pode ser
// reenviada) a mensagem que com certeza não saiu; no desfecho desconhecido a
// linha fica `pending`, e enquanto estiver assim a mesma chave não manda de novo.

type Admin = SupabaseClient<Database>;
type MessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
type Integration = Awaited<ReturnType<typeof getIntegrationCredentials>>;

/**
 * Quem envia. O analista (rota de sessão) grava `agent` + `sent_by_user_id`; o
 * token (API v1) grava o remetente do tipo dele (`ai` ou `system`) +
 * `sent_by_token_id`. O banco confere o par (trigger de autoria da mensagem).
 */
export type OutboundAuthor =
  | { kind: "user"; userId: string }
  | { kind: "token"; tokenId: string; senderType: "ai" | "system" };

export type OutboundConversation = {
  id: string;
  external_id: string | null;
  contact_phone: string | null;
  integration_id: string | null;
};

export type SendOutboundTextInput<TRefusal = never> = {
  conversation: OutboundConversation;
  /** O texto como veio no pedido. */
  content: string;
  /**
   * Do pedido ao que vai ao contato (a assinatura do analista). Só vale no 1º
   * envio: no reenvio vai o texto da linha, senão a assinatura dobraria.
   */
  finalize: (content: string) => string;
  /** Identificador do envio: o mesmo nunca vira duas mensagens. */
  clientId: string | null;
  /** Id da NOSSA chat_messages sendo respondida. */
  quotedMessageId: string | null;
  author: OutboundAuthor;
  now: string;
  /**
   * Última conferência de quem chama, feita só quando a mensagem VAI ao
   * provedor: repetir uma chave que já saiu não passa por aqui. Devolver algo
   * cancela o envio antes de gravar qualquer coisa.
   */
  beforeSend?: () => Promise<TRefusal | null>;
};

export type SendOutboundTextResult<TRefusal = never> =
  /** `existing`: o `clientId` já tinha saído (ou está saindo); nada foi reenviado. */
  | { ok: true; outcome: "sent" | "existing"; message: MessageRow }
  /**
   * `provider_failed`: a linha ficou `failed` (para o token, só quando a
   * mensagem com certeza não saiu).
   * `not_author`: o `clientId` é de uma linha de outro autor (a tela não
   * reenvia a mensagem de um token, nem um token a de outro).
   */
  | { ok: false; reason: "no_phone" | "no_integration" | "quoted_not_found" | "provider_failed" | "not_author" }
  /**
   * Só no envio por token. `content_mismatch`: a chave já enviou OUTRO texto.
   * `outcome_unknown`: o provedor não confirmou, e a linha segue `pending`.
   */
  | { ok: false; reason: "content_mismatch" | "outcome_unknown" }
  /** Só no envio por token: a leitura da credencial falhou, antes de qualquer gravação. */
  | { ok: false; reason: "integration_unreadable"; error: unknown }
  | { ok: false; reason: "refused"; refusal: TRefusal };

/** `metadata.editedAt`: a tela editou a mensagem depois de enviada (message-actions.ts). */
function editedOnScreen(row: MessageRow): boolean {
  const at = (row.metadata as { editedAt?: unknown } | null)?.editedAt;
  return typeof at === "string" && at.length > 0;
}

/**
 * Envia o texto e devolve a linha gravada. LANÇA em erro de banco (a rota
 * responde 500); falha do provedor volta como `provider_failed`, com a linha
 * já marcada `failed`, ou, para o token, como `outcome_unknown`, com a linha
 * ainda `pending`.
 */
export async function sendOutboundText<TRefusal = never>(
  supabase: Admin,
  input: SendOutboundTextInput<TRefusal>
): Promise<SendOutboundTextResult<TRefusal>> {
  const { conversation, content, clientId, quotedMessageId, author, now } = input;
  const id = conversation.id;
  const byToken = author.kind === "token";

  const phone = resolveConversationChannelAddress(conversation);
  if (!phone) return { ok: false, reason: "no_phone" };

  let integration: Integration;
  try {
    integration = await getIntegrationCredentials(supabase, conversation.integration_id);
  } catch (error) {
    // Para o token é uma leitura que falhou, e nada foi gravado: a API responde
    // 503, como nas outras leituras. A tela segue lançando, como sempre.
    if (!byToken) throw error;
    return { ok: false, reason: "integration_unreadable", error };
  }
  if (!integration) return { ok: false, reason: "no_integration" };

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

  /**
   * A linha que já existe para a chave e não vai ser reenviada. Para o token,
   * `pending` não é "enviada": ou outro pedido ainda está enviando, ou o
   * provedor nunca confirmou. Ele repete a mesma chave até a linha andar. A
   * linha apagada é devolvida como está: só se apaga o que chegou ao provedor.
   */
  const settled = (row: MessageRow): SendOutboundTextResult<TRefusal> =>
    byToken && row.delivery_status === "pending" && !row.is_deleted
      ? { ok: false, reason: "outcome_unknown" }
      : { ok: true, outcome: "existing", message: row };

  if (existing) {
    // Cada linha só é devolvida ou reenviada por quem a escreveu. Sem isto, o
    // "Tentar novamente" da tela mandaria o texto da IA como se fosse dela, a
    // qualquer hora, com a conversa já nas mãos do analista.
    const own =
      author.kind === "user" ? existing.sent_by_token_id == null : existing.sent_by_token_id === author.tokenId;
    if (!own) return { ok: false, reason: "not_author" };

    // A chave do token vale para UM texto: com outro, reenviar mandaria o
    // antigo e responderia como se fosse o novo. Linha apagada ou editada pela
    // tela já não guarda o texto original, e não dá para comparar.
    if (byToken && !existing.is_deleted && !editedOnScreen(existing) && existing.content !== input.finalize(content)) {
      return { ok: false, reason: "content_mismatch" };
    }
  }

  // Já saiu (ou está saindo): devolve a mesma linha, sem reenviar nada. O token
  // também não reenvia a linha que alguém apagou: sairia de novo ao cliente uma
  // mensagem que o CRM mostra como apagada.
  if (existing && (existing.delivery_status !== "failed" || (byToken && existing.is_deleted))) {
    return settled(existing);
  }

  // Grava-se o MESMO texto que vai ao contato — o histórico do CRM reflete
  // exatamente o que foi enviado.
  //
  // No reenvio o texto vem da LINHA, não do corpo: assinar de novo o que já
  // está assinado poria a assinatura duas vezes na mensagem do contato.
  const outboundContent = existing?.content ?? input.finalize(content);
  const quotedId = existing ? existing.quoted_message_id : quotedMessageId ?? null;

  // Responder: o provedor cita pelo id DELE (`external_id`), não pelo nosso.
  const quote = await resolveQuotedExternalId(supabase, id, quotedId);
  if (!quote.ok) return { ok: false, reason: "quoted_not_found" };
  const replyExternalId = quote.externalId;
  const linkPreview = buildMessageLinkPreview(outboundContent);

  if (input.beforeSend) {
    const refusal = await input.beforeSend();
    if (refusal !== null) return { ok: false, reason: "refused", refusal };
  }

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
          sender_type: author.kind === "user" ? "agent" : author.senderType,
          type: "text",
          content: outboundContent,
          quoted_message_id: quotedId,
          metadata: {
            ...(clientId ? { clientId } : {}),
            ...(linkPreview ? { linkPreview } : {}),
          },
          delivery_status: "pending",
          ...(author.kind === "user" ? { sent_by_user_id: author.userId } : { sent_by_token_id: author.tokenId }),
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
    // Token: se a vencedora já falhou, a mensagem não saiu; devolvê-la como
    // "já enviada" guardaria um 200 de uma mensagem que não foi.
    if (winner && byToken && winner.delivery_status === "failed") return { ok: false, reason: "provider_failed" };
    if (winner) return settled(winner);
  }
  if (msgErr || !msg) throw msgErr ?? new Error("insert failed");

  // 2) Envia pelo provedor.
  let accepted = false;
  try {
    const result = await sendUazapiText(integration.apiUrl, integration.token, phone, outboundContent, {
      trackId: msg.id,
      replyId: replyExternalId,
    });
    accepted = true;
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
    // Token, e o provedor já tinha aceitado: a mensagem saiu, e o que falhou
    // foi a nossa gravação. Marcar `failed` faria a repetição mandar de novo.
    if (byToken && accepted) throw sendErr;
    // Token, e não dá para saber se saiu: a linha fica `pending`. O eco e os
    // ticks do webhook a levam adiante se o provedor enviou.
    if (byToken && !uazapiSendDefinitelyFailed(sendErr)) {
      console.error("[send] provedor não confirmou o envio:", sendErr, msg.id);
      return { ok: false, reason: "outcome_unknown" };
    }
    await supabase
      .from("chat_messages")
      .update({ delivery_status: "failed" })
      .eq("id", msg.id)
      .in("delivery_status", overridableFrom("failed"));
    console.error("[send] provider send failed:", sendErr);
    return { ok: false, reason: "provider_failed" };
  }

  const { data: finalMsg } = await supabase.from("chat_messages").select().eq("id", msg.id).single();

  return { ok: true, outcome: "sent", message: finalMsg ?? msg };
}
