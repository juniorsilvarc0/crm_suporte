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
import {
  getChatIntegrationSecret,
  getUazapiIntegration,
} from "@/features/chat/lib/connection/integration";
import { downloadUazapiMedia } from "@/features/chat/lib/connection/uazapi";
import { persistInboundMedia } from "@/features/chat/lib/media/persist-inbound";
import {
  storedMediaColumns,
  storedMediaMetadata,
} from "@/features/chat/lib/media/stored-media";
import { overridableFrom } from "@/features/chat/lib/delivery-status";
import { getRelayUrl } from "@/features/settings/lib/get-relay-url";
import { safeEqual } from "@/lib/security/safe-equal";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tipos cuja mídia chega separada da mensagem (ver passo 4). */
const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"];

export async function POST(request: Request) {
  try {
    // 1) Autenticação via query param (?s=): a uazapi não manda header
    //    próprio. O segredo é da integração, gerado ao conectar e guardado no
    //    Vault. Falha fechada: sem integração ou sem segredo, ninguém entra —
    //    e a resposta é a mesma 401, para não contar a quem não se autenticou
    //    se existe instância configurada.
    const supabase = createSupabaseAdminClient();
    const integration = await getUazapiIntegration(supabase);
    const expected = integration
      ? await getChatIntegrationSecret(supabase, integration.id, "webhook_secret")
      : null;
    const received = new URL(request.url).searchParams.get("s") ?? "";
    if (!integration || !expected || !safeEqual(received, expected)) {
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as UazapiEnvelope;

    const event = uazapiEventType(payload);
    const message = getUazapiMessage(payload);

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

        // Linha a linha: a unicidade do `external_id` é por conversa, e cada
        // mensagem aponta a mídia para o PRÓPRIO id (`/api/chat/media/<id>`).
        // Miniatura e dimensões entram no metadata: é por aqui que chega a
        // maior parte da mídia recebida.
        for (const externalId of media.messageIds) {
          const { data: rows } = await supabase
            .from("chat_messages")
            .select("id, metadata, media_key")
            .eq("external_id", externalId);

          for (const row of rows ?? []) {
            // Falhou a re-hospedagem e a mensagem já tem mídia guardada: a URL
            // do provedor, que expira, não substitui o que já está no bucket.
            if (!rehosted && row.media_key) continue;

            const current: Record<string, Json> =
              row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
                ? (row.metadata as Record<string, Json>)
                : {};
            const mediaMeta = rehosted ? storedMediaMetadata(row.id, rehosted) : null;
            await supabase
              .from("chat_messages")
              .update({
                ...(rehosted
                  ? storedMediaColumns(row.id, rehosted)
                  : { media_url: media.fileUrl }),
                media_mime_type: media.mimetype,
                ...(mediaMeta ? { metadata: { ...current, ...mediaMeta } } : {}),
              })
              .eq("id", row.id);
          }
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
      // Só a forma do evento: o envelope traz o `token` da instância e o texto
      // da conversa, e nenhum dos dois pode ir para o log.
      console.info("[webhook/uazapi] não reconhecido:", {
        eventType: payload.EventType ?? null,
        messageType: message?.messageType ?? null,
      });
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
    // para a mídia recém-baixada acima, nos dois sentidos. Falhando, a
    // mensagem fica com a URL do provedor.
    const stored = normalized.media_url
      ? await persistInboundMedia(
          supabase,
          "chat",
          normalized.media_url,
          normalized.media_mime_type,
          { token: integration.token, tokenOrigin: integration.apiUrl }
        )
      : null;

    // Sem reativar nem tocar a interação: a mensagem ainda pode ser um retry.
    // Quem faz isso é o trigger do INSERT real da mensagem, uma vez só.
    const identity = await resolveContactIdentity(supabase, {
      phone: normalized.contact_phone,
      name: normalized.contact_name,
      source: "whatsapp",
      reactivate: false,
    });

    const conv = await upsertMessage(integration.id, identity.contactId, normalized, stored);

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
