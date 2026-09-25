import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeUazapiWebhook,
  extractUazapiDeletion,
  extractUazapiStatuses,
  extractUazapiMedia,
  getUazapiMessage,
  uazapiEventType,
  type UazapiEnvelope,
} from "@/features/chat/lib/normalizers/uazapi";
import { upsertMessage } from "@/features/chat/lib/upsert-message";
import { resolveContactIdentity } from "@/features/contacts/queries/resolve-contact-identity";
import { getUazapiIntegration } from "@/features/chat/lib/connection/integration";
import { downloadUazapiMedia } from "@/features/chat/lib/connection/uazapi";
import { persistInboundMedia } from "@/features/chat/lib/media/persist-inbound";
import { overridableFrom } from "@/features/chat/lib/delivery-status";
import { getRelayUrl } from "@/features/settings/lib/get-relay-url";
import type { StoredMedia } from "@/lib/storage/put-media";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O que da mídia guardada precisa virar `metadata` da mensagem.
 *
 * `thumbUrl` porque o R2 não tem transformação sob demanda — a miniatura é um
 * objeto de verdade, gerado na entrada, e a bolha precisa saber o endereço.
 * `mediaWidth`/`mediaHeight` porque sem eles a foto remede a linha ao carregar
 * e a conversa salta debaixo do dedo (o WebKit não tem scroll anchoring).
 *
 * Devolve `null` quando não há nada a acrescentar — aí o `metadata` nem é
 * tocado, e um UPDATE a menos é um UPDATE a menos no caminho do webhook.
 */
function buildMediaMetadata(stored: StoredMedia | null): Record<string, Json> | null {
  if (!stored) return null;
  const meta: Record<string, Json> = {};
  if (stored.thumbUrl) meta.thumbUrl = stored.thumbUrl;
  if (stored.width && stored.height) {
    meta.mediaWidth = stored.width;
    meta.mediaHeight = stored.height;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

/** Tipos cuja mídia chega separada da mensagem (ver passo 4). */
const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"];

export async function POST(request: Request) {
  try {
    // 1) Autenticação do webhook via query param (?s=).
    const url = new URL(request.url);
    const secret = process.env.UAZAPI_WEBHOOK_SECRET;
    if (secret && url.searchParams.get("s") !== secret) {
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as UazapiEnvelope;
    const supabase = createSupabaseAdminClient();

    const integration = await getUazapiIntegration(supabase);
    if (!integration) {
      return NextResponse.json({ ok: false, reason: "no_integration" });
    }

    const event = uazapiEventType(payload);
    const message = getUazapiMessage(payload);

    // DEBUG temporário: loga só os objetos message/event (sem o `chat` gigante)
    // para confirmar/afinar os nomes de campo contra a instância real.
    if (message) {
      console.info("[uazapi-dbg] msg:", JSON.stringify(message).slice(0, 1600));
    }
    if (payload.event) {
      console.info("[uazapi-dbg] evt:", JSON.stringify(payload.event).slice(0, 1200));
    }

    // 2) messages_update → apagada, mídia baixada (FileDownloaded) OU status.
    if (event === "messages_update") {
      // Apagada — pelo contato no celular dele, ou por nós via /message/delete.
      // Espelha exatamente o que a rota DELETE grava, para os dois caminhos
      // deixarem a mensagem no mesmo estado.
      const deleted = extractUazapiDeletion(payload);
      if (deleted) {
        await supabase
          .from("chat_messages")
          .update({ is_deleted: true, content: null, media_url: null })
          .in("external_id", deleted);
        return NextResponse.json({ ok: true, deleted: deleted.length });
      }

      const media = extractUazapiMedia(payload);
      if (media) {
        if (media.isGroup) {
          return NextResponse.json({ ok: true, reason: "group_media_skip" });
        }
        // Re-hospeda a mídia (URLs da uazapi expiram) e anexa à(s) mensagem(ns).
        // `folder` fixo: o telefone saiu do caminho do arquivo (ver media-key).
        const rehosted = await persistInboundMedia(
          supabase,
          "chat",
          media.fileUrl,
          media.mimetype,
          { token: integration.token, tokenOrigin: integration.apiUrl }
        );
        const mediaUrl = rehosted?.url ?? media.fileUrl;

        // Miniatura e dimensões entram no metadata da mensagem: é por aqui que
        // chega a maior parte da mídia recebida, e sem isso a bolha voltaria a
        // servir o arquivo cheio e a remedir a linha quando a foto carrega.
        const mediaMeta = buildMediaMetadata(rehosted);

        for (const id of media.messageIds) {
          const patch: {
            media_url: string;
            media_mime_type: string | null;
            metadata?: Record<string, Json>;
          } = {
            media_url: mediaUrl,
            media_mime_type: media.mimetype,
          };
          if (mediaMeta) {
            const { data: row } = await supabase
              .from("chat_messages")
              .select("metadata")
              .eq("external_id", id)
              .maybeSingle();
            const current: Record<string, Json> =
              row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
                ? (row.metadata as Record<string, Json>)
                : {};
            patch.metadata = { ...current, ...mediaMeta };
          }
          await supabase.from("chat_messages").update(patch).eq("external_id", id);
        }
        return NextResponse.json({ ok: true, media: media.messageIds.length });
      }

      // Status (monótono; casa por external_id = MessageIDs).
      const statuses = extractUazapiStatuses(payload);
      for (const s of statuses) {
        const from = overridableFrom(s.status);
        if (from.length === 0) continue;
        await supabase
          .from("chat_messages")
          .update({ delivery_status: s.status })
          .eq("external_id", s.messageid)
          .in("delivery_status", from);
      }
      return NextResponse.json({ ok: true, statuses: statuses.length });
    }

    // 3) messages → echo da nossa própria msg (fromMe + track_id): concilia, não duplica.
    if (message?.fromMe && message.track_id) {
      const messageid = message.messageid ?? message.id ?? null;
      if (messageid) {
        await supabase
          .from("chat_messages")
          .update({ external_id: messageid })
          .eq("id", message.track_id);
      }
      return NextResponse.json({ ok: true, reason: "echo_reconciled" });
    }

    // 3.1) Eco de mensagem nossa que JÁ existe, sem `track_id` — é o caso de uma
    //      edição (o /message/edit gera um id novo, que a rota grava antes de o
    //      eco chegar) e o de uma mensagem digitada no celular do dono que volta
    //      duas vezes.
    //
    //      Não pode cair no `upsertMessage`: ele grava `delivery_status: 'sent'`
    //      fixo em outbound, e o eco faria o tick REGREDIR de lido para enviado.
    //      Aqui só o conteúdo é atualizado.
    if (message?.fromMe) {
      const echoId = message.messageid ?? message.id ?? null;
      if (echoId) {
        // `limit(1)` antes do `maybeSingle`: a unicidade é por
        // (conversation_id, external_id), então em tese o mesmo id pode
        // aparecer em duas conversas — e aí o `maybeSingle` sozinho ERRA, o
        // webhook devolve 500 e a mensagem se perde.
        const { data: known } = await supabase
          .from("chat_messages")
          .select("id, type, media_url, metadata")
          .eq("external_id", echoId)
          .limit(1)
          .maybeSingle();

        // Só curto-circuita se não houver mídia pendente: com `media_url`
        // vazio, o passo 4 ainda pode buscar o arquivo pelo /message/download,
        // e roubar isso deixaria a mensagem presa em "carregando…".
        const mediaPending = MEDIA_TYPES.includes(known?.type ?? "") && !known?.media_url;

        if (known && !mediaPending) {
          const echoed = normalizeUazapiWebhook(payload);
          if (echoed?.content) {
            const currentMetadata =
              known.metadata &&
              typeof known.metadata === "object" &&
              !Array.isArray(known.metadata)
                ? known.metadata
                : {};
            const echoedMetadata =
              echoed.metadata &&
              typeof echoed.metadata === "object" &&
              !Array.isArray(echoed.metadata)
                ? echoed.metadata
                : null;
            await supabase
              .from("chat_messages")
              .update({
                content: echoed.content,
                ...(echoedMetadata
                  ? {
                      metadata: {
                        ...currentMetadata,
                        ...echoedMetadata,
                      },
                    }
                  : {}),
              })
              .eq("id", known.id);
          }
          return NextResponse.json({ ok: true, reason: "echo_known" });
        }
      }
    }

    // 4) Mensagem nova (inbound ou fromMe do próprio celular). Conversa chaveada
    //    pelo chatid (o contraparte) — ver normalizer.
    const normalized = normalizeUazapiWebhook(payload);
    if (!normalized) {
      console.info(
        "[webhook/uazapi] não reconhecido:",
        JSON.stringify(payload).slice(0, 500)
      );
      return NextResponse.json({ ok: true, reason: "skipped" });
    }

    // Toda mídia sem URL é buscada por `/message/download`, que devolve a versão
    // pronta (decriptada e hospedada na uazapi). NÃO dependa do evento
    // `FileDownloaded` para isso.
    //
    // Isto já valia para a saída, que nunca emite `FileDownloaded`. Medido em
    // 2026-08-06, a ENTRADA também não pode depender do evento: 260 de 362
    // mídias recebidas estavam presas em "carregando…" — documento e vídeo em
    // 100%, áudio e imagem perto de 2/3. Testado contra a instância real, o
    // `/message/download` recuperou 17 de 17 dessas mensagens.
    //
    // `downloadUazapiMedia` engole erro e devolve null, então isto é aditivo:
    // falhando, o `FileDownloaded` continua sendo o caminho de trás.
    if (
      MEDIA_TYPES.includes(normalized.type) &&
      !normalized.media_url &&
      normalized.external_id
    ) {
      const dl = await downloadUazapiMedia(
        integration.apiUrl,
        integration.token,
        normalized.external_id
      );
      if (dl) {
        normalized.media_url = dl.fileURL;
        normalized.media_mime_type = normalized.media_mime_type ?? dl.mimetype;
      }
    }

    // Re-hospeda a mídia no chat-media (URLs da uazapi/WhatsApp expiram). Vale
    // para a mídia recém-baixada acima, nos dois sentidos.
    if (normalized.media_url) {
      const rehosted = await persistInboundMedia(
        supabase,
        "chat",
        normalized.media_url,
        normalized.media_mime_type,
        { token: integration.token, tokenOrigin: integration.apiUrl }
      );
      if (rehosted) {
        normalized.media_url = rehosted.url;
        const mediaMeta = buildMediaMetadata(rehosted);
        if (mediaMeta) {
          // As dimensões medidas no arquivo GUARDADO vencem as do payload da
          // uazapi: é este arquivo que a bolha vai exibir, já redimensionado.
          normalized.metadata = {
            ...((normalized.metadata ?? {}) as Record<string, Json>),
            ...mediaMeta,
          };
        }
      }
    }

    // Sem reativar nem tocar a interação: a mensagem ainda pode ser um retry.
    // Quem faz isso é o trigger do INSERT real da mensagem, uma vez só.
    const identity = await resolveContactIdentity(supabase, {
      phone: normalized.contact_phone,
      name: normalized.contact_name,
      source: "whatsapp",
      reactivate: false,
    });

    const conv = await upsertMessage(integration.id, identity.contactId, normalized);

    // 5) Repassa ao agente/automação só inbound e enquanto status='bot'.
    // URL configurável na UI (Configurações), com fallback para N8N_WEBHOOK_URL.
    if (normalized.direction === "inbound" && conv?.status === "bot") {
      const relayUrl = await getRelayUrl();
      if (relayUrl) {
        void fetch(relayUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch((e) => console.warn("[webhook/uazapi] relay falhou:", e));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook/uazapi]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
